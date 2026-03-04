"""
Lógica de negocio para cada tipo de evento de Fintoc.
"""
import asyncio

from odoo_client import OdooClient

odoo = OdooClient()


async def handle_inbound_transfer(data: dict):
    """
    Cobro recibido de un cliente vía SPEI.

    Flujo:
    1. Extraer monto y metadata (odoo_partner_id) de la CLABE virtual
    2. Buscar facturas pendientes del cliente en Odoo
    3. Aplicar pago con forma de pago SAT 03 (Transferencia) para Complemento de Pago
    4. Verificar que se generó el Complemento de Pago (UUID) y loguear o alertar
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
    paid_invoice_ids = []

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
        paid_invoice_ids.append(invoice["id"])
        remaining -= pay_amount

    # Dar tiempo a Odoo/PAC para generar el Complemento de Pago
    if paid_invoice_ids:
        await asyncio.sleep(5)
        for inv_id in paid_invoice_ids[-3:]:  # últimas 3 facturas pagadas
            payment_id = odoo.get_last_payment_for_invoice(inv_id)
            if payment_id:
                status = odoo.get_payment_cfdi_status(payment_id)
                if status and status.get("uuid"):
                    print(f"[COMPLEMENTO PAGO] Factura ID {inv_id} → UUID: {status['uuid']}")
                elif status and status.get("sat_status") != "valid":
                    print(f"[AVISO] Complemento de Pago pendiente o fallido para factura ID {inv_id}: {status}")


async def handle_outbound_succeeded(data: dict):
    """
    Pago a proveedor enviado con éxito.
    Registra el pago sobre la factura del proveedor en Odoo y verifica Complemento de Pago.
    """
    amount_mxn = data["amount"] / 100
    ref = data.get("reference_id", "")
    tracking = data.get("tracking_key", "")
    recipient = data.get("counterparty", {}).get("holder_name", "")
    memo = f"SPEI Fintoc | {tracking} | Pago a proveedor"

    print(f"[PAGO OK] ${amount_mxn:.2f} MXN → {recipient} | Ref: {ref} | SPEI: {tracking}")

    if ref:
        bill = odoo.get_bill_by_name(ref)
        if bill and bill.get("amount_residual", 0) > 0:
            try:
                odoo.register_vendor_payment(
                    bill_id=bill["id"],
                    amount=amount_mxn,
                    memo=memo,
                )
                print(f"[ODOO] Pago registrado en factura de proveedor {ref}")
                await asyncio.sleep(5)
                payment_id = odoo.get_last_payment_for_invoice(bill["id"])
                if payment_id:
                    status = odoo.get_payment_cfdi_status(payment_id)
                    if status and status.get("uuid"):
                        print(f"[COMPLEMENTO PAGO] Bill {ref} → UUID: {status['uuid']}")
            except Exception as e:
                print(f"[AVISO] No se pudo registrar pago en Odoo para {ref}: {e}")
        elif bill:
            print(f"[AVISO] Factura {ref} ya está pagada o no tiene saldo pendiente.")
        else:
            print(f"[AVISO] No se encontró factura de proveedor con nombre {ref}.")


async def handle_outbound_rejected(data: dict):
    """Pago a proveedor rechazado. Busca la factura por reference_id y agrega nota en Odoo."""
    amount_mxn = data["amount"] / 100
    ref = data.get("reference_id", "")
    reason = data.get("return_reason", "sin razón")
    recipient = data.get("counterparty", {}).get("holder_name", "")

    print(f"[PAGO RECHAZADO] ${amount_mxn:.2f} MXN → {recipient} | Ref: {ref} | Razón: {reason}")

    if ref:
        bill = odoo.get_bill_by_name(ref)
        if bill:
            try:
                odoo._call(
                    "account.move", "message_post",
                    [[bill["id"]]],
                    {"body": f"Pago SPEI Fintoc RECHAZADO. Monto: ${amount_mxn:.2f} MXN. Razón: {reason}", "message_type": "comment"},
                )
            except Exception as e:
                print(f"[AVISO] No se pudo agregar nota en Odoo: {e}")


async def handle_clabe_verified(data: dict):
    """CLABE de proveedor verificada correctamente."""
    clabe = data.get("counterparty", {}).get("account_number", "")
    holder_name = data.get("counterparty", {}).get("holder_name", "")
    holder_id = data.get("counterparty", {}).get("holder_id", "")

    print(f"[CLABE OK] {clabe} | Titular: {holder_name} | RFC: {holder_id}")
