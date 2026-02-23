"""
Lógica de negocio para cada tipo de evento de Fintoc.
"""
from odoo_client import OdooClient

odoo = OdooClient()


async def handle_inbound_transfer(data: dict):
    """
    Cobro recibido de un cliente vía SPEI.

    Flujo:
    1. Extraer monto y metadata (odoo_partner_id) de la CLABE virtual
    2. Buscar facturas pendientes del cliente en Odoo
    3. Aplicar pago a la(s) factura(s) correspondiente(s), de la más antigua a la más nueva
    """
    amount_mxn = data["amount"] / 100
    tracking_key = data.get("tracking_key", "")
    comment = data.get("comment", "")

    account_number_meta = data.get("account_number", {}).get("metadata", {})
    odoo_partner_id = account_number_meta.get("odoo_partner_id")
    partner_name = account_number_meta.get("partner_name", "Desconocido")

    print(f"[COBRO] ${amount_mxn:.2f} MXN de {partner_name} | SPEI: {tracking_key}")

    if not odoo_partner_id:
        print("[ERROR] No se pudo identificar al cliente. Revisar metadata de CLABE.")
        return

    invoices = odoo.get_pending_invoices(partner_id=int(odoo_partner_id))

    if not invoices:
        print(f"[AVISO] No hay facturas pendientes para {partner_name}. Pago pendiente de aplicar.")
        return

    memo = f"SPEI Fintoc | {tracking_key} | {comment}"
    remaining = amount_mxn

    for invoice in sorted(invoices, key=lambda x: x["invoice_date_due"] or ""):
        if remaining <= 0:
            break
        invoice_amount = invoice["amount_residual"]
        pay_amount = min(remaining, invoice_amount)

        odoo.register_payment(
            invoice_id=invoice["id"],
            amount=pay_amount,
            memo=memo,
        )
        print(f"[ODOO] Pago ${pay_amount:.2f} aplicado a {invoice['name']}")
        remaining -= pay_amount


async def handle_outbound_succeeded(data: dict):
    """Pago a proveedor enviado con éxito."""
    amount_mxn = data["amount"] / 100
    ref = data.get("reference_id", "")
    tracking = data.get("tracking_key", "")
    recipient = data.get("counterparty", {}).get("holder_name", "")

    print(f"[PAGO OK] ${amount_mxn:.2f} MXN → {recipient} | Ref: {ref} | SPEI: {tracking}")


async def handle_outbound_rejected(data: dict):
    """Pago a proveedor rechazado."""
    amount_mxn = data["amount"] / 100
    ref = data.get("reference_id", "")
    reason = data.get("return_reason", "sin razón")
    recipient = data.get("counterparty", {}).get("holder_name", "")

    print(f"[PAGO RECHAZADO] ${amount_mxn:.2f} MXN → {recipient} | Ref: {ref} | Razón: {reason}")


async def handle_clabe_verified(data: dict):
    """CLABE de proveedor verificada correctamente."""
    clabe = data.get("counterparty", {}).get("account_number", "")
    holder_name = data.get("counterparty", {}).get("holder_name", "")
    holder_id = data.get("counterparty", {}).get("holder_id", "")

    print(f"[CLABE OK] {clabe} | Titular: {holder_name} | RFC: {holder_id}")
