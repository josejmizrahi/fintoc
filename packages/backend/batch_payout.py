"""
Lee un CSV con columnas: clabe, amount_mxn, reference_id, comment
Envía todos los pagos SPEI de forma masiva.
Si reference_id coincide con una factura de proveedor en Odoo, valida el CFDI ante el SAT antes de pagar.

CSV ejemplo (pagos_batch.csv):
  clabe,amount_mxn,reference_id,comment
  012345678901234567,15000.00,BILL/2026/0042,Pago proveedor Aceros SA
  646180157047452829,8500.50,BILL/2026/0043,Pago proveedor Textiles MX

Opciones:
  --no-validate-sat   No validar CFDIs contra SAT (pagar siempre que haya CLABE)
"""
import argparse
import uuid

import pandas as pd

from fintoc_client import FintocManager
from odoo_client import OdooClient
from sat_client import get_sat_client

fintoc = FintocManager()
odoo = OdooClient()


def validate_bill_cfdi_if_exists(reference_id: str) -> tuple[bool, str]:
    """
    Si reference_id es nombre de una factura de proveedor en Odoo, valida su CFDI ante SAT.
    Returns (valid, message). valid=True si no hay factura o si está vigente.
    """
    bill = odoo.get_bill_by_name(str(reference_id).strip())
    if not bill:
        return True, "no_bill"
    cfdi = odoo.get_vendor_bill_cfdi(bill["id"])
    if not cfdi or not cfdi.get("uuid"):
        return True, "no_cfdi"
    rfc_emisor = (cfdi.get("rfc_emisor") or "").strip()
    rfc_receptor = (cfdi.get("rfc_receptor") or "").strip()
    total = cfdi.get("amount_total")
    uuid_cfdi = cfdi.get("uuid", "").strip()
    if not all([rfc_emisor, rfc_receptor, total, uuid_cfdi]):
        return False, "datos_fiscales_incompletos"
    sat = get_sat_client()
    if not sat.es_cfdi_valido(rfc_emisor, rfc_receptor, total, uuid_cfdi):
        r = sat.validar_cfdi(rfc_emisor, rfc_receptor, total, uuid_cfdi)
        return False, f"SAT: {r.get('Estado', '')} | {r.get('CodigoEstatus', '')}"
    return True, "valid"


def main():
    parser = argparse.ArgumentParser(description="Pagos masivos SPEI con validación SAT opcional")
    parser.add_argument("csv", nargs="?", default="pagos_batch.csv", help="Archivo CSV de pagos")
    parser.add_argument("--no-validate-sat", action="store_true", help="No validar CFDIs contra SAT")
    args = parser.parse_args()

    df = pd.read_csv(args.csv)
    print(f"Procesando {len(df)} pagos...")

    resultados = []
    for _, row in df.iterrows():
        ref = str(row["reference_id"])
        if not args.no_validate_sat:
            valid, msg = validate_bill_cfdi_if_exists(ref)
            if not valid:
                print(f"  [SKIP SAT] {ref} → {msg}")
                resultados.append({
                    **row.to_dict(),
                    "transfer_id": "",
                    "status": "skipped_sat",
                    "error": msg,
                })
                continue

        try:
            result = fintoc.send_payout(
                clabe_destino=str(row["clabe"]),
                amount_mxn=float(row["amount_mxn"]),
                comment=str(row.get("comment", "Pago Quimibond")),
                reference_id=ref,
                idempotency_key=str(uuid.uuid4()),
            )
            print(f"  [OK] {ref} → {result['status']}")
            resultados.append({**row.to_dict(), **result, "error": ""})
        except Exception as e:
            print(f"  [ERROR] {ref} → {e}")
            resultados.append({
                **row.to_dict(),
                "transfer_id": "",
                "status": "error",
                "error": str(e),
            })

    out_path = "pagos_batch_resultado.csv"
    pd.DataFrame(resultados).to_csv(out_path, index=False)
    print(f"Resultados guardados en {out_path}")


if __name__ == "__main__":
    main()
