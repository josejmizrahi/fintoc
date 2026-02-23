"""
Servidor FastAPI que recibe eventos de Fintoc en tiempo real.
Debe estar en una URL pública con HTTPS (ej: nginx reverse proxy).

Eventos que maneja:
  - transfer.inbound.succeeded   → cobro recibido → pagar factura en Odoo
  - transfer.outbound.succeeded  → pago a proveedor confirmado → log en Odoo
  - transfer.outbound.rejected   → pago rechazado → alerta
  - account_verification.succeeded → CLABE verificada → guardar en Odoo
"""
import json
import os

from fastapi import FastAPI, HTTPException, Request
from fintoc.errors import WebhookSignatureError
from fintoc.webhook import WebhookSignature

from config import FINTOC_WEBHOOK_SECRET
from webhook_handlers import (
    handle_clabe_verified,
    handle_inbound_transfer,
    handle_outbound_rejected,
    handle_outbound_succeeded,
)

app = FastAPI(title="Fintoc Webhook — Quimibond")

# IDs de eventos ya procesados (idempotencia simple en memoria).
# En producción: usar Redis o tabla en Odoo.
processed_events: set = set()


@app.post(os.getenv("WEBHOOK_PATH", "/fintoc/webhook"))
async def fintoc_webhook(request: Request):
    payload = await request.body()
    payload_str = payload.decode("utf-8")
    signature = request.headers.get("Fintoc-Signature", "")

    try:
        WebhookSignature.verify_header(
            payload=payload_str,
            header=signature,
            secret=FINTOC_WEBHOOK_SECRET,
        )
    except WebhookSignatureError as e:
        raise HTTPException(status_code=400, detail=f"Firma inválida: {e}")

    event = json.loads(payload_str)
    event_id = event.get("id", "")
    event_type = event.get("type", "")

    if event_id in processed_events:
        return {"status": "already_processed"}
    processed_events.add(event_id)

    print(f"[WEBHOOK] Evento recibido: {event_type} | {event_id}")

    handlers = {
        "transfer.inbound.succeeded": handle_inbound_transfer,
        "transfer.outbound.succeeded": handle_outbound_succeeded,
        "transfer.outbound.rejected": handle_outbound_rejected,
        "account_verification.succeeded": handle_clabe_verified,
    }

    handler = handlers.get(event_type)
    if handler:
        await handler(event["data"])
    else:
        print(f"[WEBHOOK] Evento no manejado: {event_type}")

    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("WEBHOOK_PORT", 8001)))
