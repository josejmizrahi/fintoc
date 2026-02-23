"""
Flujo completo de pago a proveedor con validación SAT:

1. Recibir ID de factura de proveedor en Odoo (bill_id)
2. Extraer datos CFDI de la factura (UUID, RFC, total)
3. Validar CFDI contra SAT (Estado = Vigente, no EFOS)
4. Obtener CLABE del proveedor en Odoo
5. Enviar pago vía Fintoc (send_payout) con reference_id = nombre de la factura
6. El webhook transfer.outbound.succeeded registrará el pago en Odoo al confirmarse

Uso:
  python pay_vendor.py --bill-id 12345
  python pay_vendor.py --bill-id 12345 --skip-sat   # omitir validación SAT (no recomendado)
"""
import argparse
import uuid

from fintoc_client import FintocManager
from odoo_client import OdooClient
from sat_client import get_sat_client

odoo = OdooClient()
fintoc = FintocManager()


def pay_vendor(bill_id: int, skip_sat: bool = False) -> dict:
    """
    Orquesta: validar CFDI → obtener CLABE → enviar payout.
    reference_id = nombre de la factura para que el webhook pueda registrar el pago.
    """
    # 1. Datos de la factura y CFDI
    cfdi = odoo.get_vendor_bill_cfdi(bill_id)
    if not cfdi:
        return {"ok": False, "error": f"No se encontró factura de proveedor con ID {bill_id} o sin datos CFDI."}

    name = cfdi.get("name", "")
    amount = cfdi.get("amount_residual") or cfdi.get("amount_total")
    if amount is None or amount <= 0:
        return {"ok": False, "error": f"Factura {name} no tiene monto pendiente de pago."}

    partner_id = cfdi.get("partner_id")
    if not partner_id:
        return {"ok": False, "error": "Factura sin partner_id."}

    # 2. Validar contra SAT (salvo skip_sat)
    if not skip_sat:
        uuid_cfdi = cfdi.get("uuid")
        if not uuid_cfdi:
            return {"ok": False, "error": f"Factura {name} no tiene UUID CFDI (no está timbrada)."}
        rfc_emisor = (cfdi.get("rfc_emisor") or "").strip()
        rfc_receptor = (cfdi.get("rfc_receptor") or "").strip()
        total = cfdi.get("amount_total")
        if not all([rfc_emisor, rfc_receptor, total]):
            return {"ok": False, "error": "Faltan datos fiscales (RFC o total) para validar en SAT."}
        sat = get_sat_client()
        if not sat.es_cfdi_valido(rfc_emisor, rfc_receptor, total, uuid_cfdi):
            resultado = sat.validar_cfdi(rfc_emisor, rfc_receptor, total, uuid_cfdi)
            return {"ok": False, "error": f"CFDI no válido ante SAT: {resultado}"}

    # 3. CLABE del proveedor
    clabe = odoo.get_vendor_clabe(partner_id)
    if not clabe:
        return {"ok": False, "error": f"Proveedor (partner_id={partner_id}) no tiene CLABE registrada en Odoo."}

    # 4. Enviar pago vía Fintoc (reference_id = nombre factura para el webhook)
    comment = f"Pago Quimibond | {name}"
    try:
        result = fintoc.send_payout(
            clabe_destino=clabe,
            amount_mxn=float(amount),
            comment=comment,
            reference_id=name,
            idempotency_key=str(uuid.uuid4()),
        )
    except Exception as e:
        return {"ok": False, "error": str(e)}

    return {
        "ok": True,
        "bill_id": bill_id,
        "bill_name": name,
        "amount": amount,
        "transfer_id": result.get("transfer_id"),
        "status": result.get("status"),
        "tracking_key": result.get("tracking_key"),
    }


def main():
    parser = argparse.ArgumentParser(description="Pago a proveedor con validación SAT")
    parser.add_argument("--bill-id", type=int, required=True, help="ID de la factura de proveedor en Odoo")
    parser.add_argument("--skip-sat", action="store_true", help="Omitir validación CFDI en SAT (no recomendado)")
    args = parser.parse_args()

    out = pay_vendor(args.bill_id, skip_sat=args.skip_sat)
    if out.get("ok"):
        print(f"[OK] Pago enviado: {out['bill_name']} → {out['amount']} MXN | Transfer: {out.get('transfer_id')}")
    else:
        print(f"[ERROR] {out.get('error')}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
