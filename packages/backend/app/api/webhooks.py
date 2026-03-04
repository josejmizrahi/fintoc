"""
Endpoints de Webhooks de Fintoc.
Recibe y procesa eventos en tiempo real.
"""

import asyncio
import json
import logging

from fastapi import APIRouter, HTTPException, Request

from fintoc.errors import WebhookSignatureError
from fintoc.webhook import WebhookSignature

from app.config import get_settings
from app.database import Payment, PaymentStatus, AuditLog, get_session_factory
from app.services.notification_service import NotificationService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/webhooks", tags=["Webhooks"])

# Deduplicación en memoria (producción: usar Redis)
_processed_events: set = set()


def _get_odoo():
    from app.services.odoo_service import get_odoo_service
    return get_odoo_service()


@router.post("/fintoc")
async def fintoc_webhook(request: Request):
    """Endpoint principal para webhooks de Fintoc."""
    settings = get_settings()
    payload = await request.body()
    payload_str = payload.decode("utf-8")
    signature = request.headers.get("Fintoc-Signature", "")

    # Verificar firma
    if settings.fintoc_webhook_secret:
        try:
            WebhookSignature.verify_header(
                payload=payload_str,
                header=signature,
                secret=settings.fintoc_webhook_secret,
            )
        except WebhookSignatureError as e:
            raise HTTPException(status_code=400, detail=f"Firma inválida: {e}")

    event = json.loads(payload_str)
    event_id = event.get("id", "")
    event_type = event.get("type", "")

    # Idempotencia
    if event_id in _processed_events:
        return {"status": "already_processed"}
    _processed_events.add(event_id)

    logger.info(f"[WEBHOOK] {event_type} | {event_id}")

    data = event.get("data", {})

    if event_type == "transfer.inbound.succeeded":
        await _handle_inbound_transfer(data)
    elif event_type == "transfer.outbound.succeeded":
        await _handle_outbound_succeeded(data)
    elif event_type == "transfer.outbound.rejected":
        await _handle_outbound_rejected(data)
    elif event_type == "transfer.outbound.failed":
        await _handle_outbound_failed(data)
    elif event_type == "account_verification.succeeded":
        await _handle_clabe_verified(data)
    elif event_type == "checkout_session.finished":
        await _handle_checkout_finished(data)
    elif event_type == "payment_intent.succeeded":
        await _handle_payment_intent_succeeded(data)
    else:
        logger.info(f"[WEBHOOK] Evento no manejado: {event_type}")

    return {"status": "ok"}


async def _handle_inbound_transfer(data: dict):
    """Cobro recibido vía SPEI → registro en Odoo + complemento de pago."""
    odoo = _get_odoo()
    amount_mxn = data["amount"] / 100
    tracking_key = data.get("tracking_key", "")
    comment = data.get("comment", "")
    account_meta = data.get("account_number", {}).get("metadata", {})
    odoo_partner_id = account_meta.get("odoo_partner_id")
    partner_name = account_meta.get("partner_name", "Desconocido")

    logger.info(f"[COBRO] ${amount_mxn:.2f} MXN de {partner_name} | SPEI: {tracking_key}")

    # Registrar en DB local
    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        payment = Payment(
            direction="inbound",
            status=PaymentStatus.CONFIRMED.value,
            amount=amount_mxn,
            fintoc_tracking_key=tracking_key,
            odoo_partner_id=int(odoo_partner_id) if odoo_partner_id else None,
            partner_name=partner_name,
            comment=comment,
        )
        db.add(payment)
        db.commit()
    finally:
        db.close()

    if not odoo_partner_id:
        logger.error("[COBRO] No se pudo identificar al cliente. Revisar metadata de CLABE.")
        return

    # Aplicar pago en Odoo
    invoices = odoo.get_pending_invoices(partner_id=int(odoo_partner_id))
    if not invoices:
        logger.warning(f"[COBRO] No hay facturas pendientes para {partner_name}")
        return

    memo = f"SPEI Fintoc | {tracking_key} | {comment}"
    remaining = amount_mxn
    paid_ids = []

    for invoice in sorted(invoices, key=lambda x: x.get("invoice_date_due") or ""):
        if remaining <= 0:
            break
        residual = invoice.get("amount_residual", 0)
        pay_amount = min(remaining, residual)
        try:
            odoo.register_payment(invoice_id=invoice["id"], amount=pay_amount, memo=memo)
            logger.info(f"[ODOO] Pago ${pay_amount:.2f} aplicado a {invoice['name']}")
            paid_ids.append(invoice["id"])
            remaining -= pay_amount
        except Exception as e:
            logger.error(f"[ODOO] Error aplicando pago a {invoice['name']}: {e}")

    # Verificar complementos de pago
    if paid_ids:
        await asyncio.sleep(5)
        for inv_id in paid_ids[-3:]:
            payment_id = odoo.get_last_payment_for_invoice(inv_id)
            if payment_id:
                status = odoo.get_payment_cfdi_status(payment_id)
                if status and status.get("uuid"):
                    logger.info(f"[COMPLEMENTO] Invoice {inv_id} → UUID: {status['uuid']}")

    # Notificación
    NotificationService().notify_payment_received(amount_mxn, partner_name, tracking_key)


async def _handle_outbound_succeeded(data: dict):
    """Pago a proveedor confirmado → registro en Odoo."""
    odoo = _get_odoo()
    amount_mxn = data["amount"] / 100
    ref = data.get("reference_id", "")
    tracking = data.get("tracking_key", "")
    recipient = data.get("counterparty", {}).get("holder_name", "")

    logger.info(f"[PAGO OK] ${amount_mxn:.2f} → {recipient} | Ref: {ref}")

    # Actualizar DB local
    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        payment = db.query(Payment).filter_by(fintoc_tracking_key=tracking).first()
        if payment:
            payment.status = PaymentStatus.CONFIRMED.value
        db.commit()
    finally:
        db.close()

    # Registrar en Odoo
    if ref:
        bill = odoo.get_bill_by_name(ref)
        if bill and bill.get("amount_residual", 0) > 0:
            try:
                odoo.register_vendor_payment(
                    bill_id=bill["id"], amount=amount_mxn,
                    memo=f"SPEI Fintoc | {tracking}",
                )
                await asyncio.sleep(5)
                payment_id = odoo.get_last_payment_for_invoice(bill["id"])
                if payment_id:
                    status = odoo.get_payment_cfdi_status(payment_id)
                    if status and status.get("uuid"):
                        logger.info(f"[COMPLEMENTO] Bill {ref} → UUID: {status['uuid']}")
            except Exception as e:
                logger.error(f"[ODOO] Error registrando pago para {ref}: {e}")

    NotificationService().notify_payment_sent(amount_mxn, recipient, tracking)


async def _handle_outbound_rejected(data: dict):
    """Pago rechazado → alerta + nota en Odoo."""
    odoo = _get_odoo()
    amount_mxn = data["amount"] / 100
    ref = data.get("reference_id", "")
    reason = data.get("return_reason", "sin razón")
    recipient = data.get("counterparty", {}).get("holder_name", "")

    logger.warning(f"[PAGO RECHAZADO] ${amount_mxn:.2f} → {recipient} | {reason}")

    # Actualizar DB local
    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        tracking = data.get("tracking_key", "")
        payment = db.query(Payment).filter_by(fintoc_tracking_key=tracking).first()
        if payment:
            payment.status = PaymentStatus.FAILED.value
        db.commit()
    finally:
        db.close()

    if ref:
        bill = odoo.get_bill_by_name(ref)
        if bill:
            odoo.post_message(
                "account.move", bill["id"],
                f"Pago SPEI Fintoc RECHAZADO. ${amount_mxn:.2f} MXN. Razón: {reason}"
            )

    NotificationService().notify_payment_failed(amount_mxn, recipient, reason)


async def _handle_outbound_failed(data: dict):
    """Pago fallido."""
    await _handle_outbound_rejected(data)


async def _handle_clabe_verified(data: dict):
    """CLABE verificada → log."""
    clabe = data.get("counterparty", {}).get("account_number", "")
    holder = data.get("counterparty", {}).get("holder_name", "")
    rfc = data.get("counterparty", {}).get("holder_id", "")
    logger.info(f"[CLABE OK] {clabe} | {holder} | RFC: {rfc}")


async def _handle_checkout_finished(data: dict):
    """Checkout session finalizado → verificar pago."""
    logger.info(f"[CHECKOUT] Session finalizada: {data.get('id', '')}")


async def _handle_payment_intent_succeeded(data: dict):
    """Payment intent exitoso → registrar cobro."""
    amount = data.get("amount", 0) / 100
    metadata = data.get("metadata", {})
    logger.info(f"[PAYMENT INTENT] ${amount:.2f} MXN | metadata: {metadata}")
