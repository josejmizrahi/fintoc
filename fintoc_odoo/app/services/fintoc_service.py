"""
Servicio Fintoc mejorado: cobertura completa del API de Fintoc para México.

Soporta:
- CLABEs virtuales (inbound)
- Transferencias SPEI salientes (outbound)
- Checkout Sessions (cobros en línea)
- Verificación de CLABEs
- Data aggregation (movimientos bancarios)
- Webhook management
- Simulación (modo test)
"""

import json
import logging
import uuid as uuid_lib
from datetime import datetime, timezone
from typing import Any, Optional

from fintoc import Fintoc

from app.config import get_settings

logger = logging.getLogger(__name__)


class FintocService:
    """Wrapper completo sobre el SDK/API de Fintoc para México."""

    def __init__(self):
        settings = get_settings()
        import os

        jws_path = settings.jws_private_key_path
        if jws_path and os.path.exists(jws_path):
            self.client = Fintoc(settings.fintoc_secret_key, jws_private_key=jws_path)
        else:
            self.client = Fintoc(settings.fintoc_secret_key)
        self.account_id = settings.fintoc_account_id
        self.public_key = settings.fintoc_public_key

    # ── CLABEs Virtuales ──

    def create_clabe(
        self, odoo_partner_id: int, partner_name: str, metadata: dict | None = None
    ) -> dict:
        """Crea una CLABE virtual única para un cliente/proveedor."""
        meta = {
            "odoo_partner_id": str(odoo_partner_id),
            "partner_name": partner_name,
        }
        if metadata:
            meta.update(metadata)
        acno = self.client.v2.account_numbers.create(
            account_id=self.account_id, metadata=meta
        )
        logger.info(f"CLABE creada: {acno.number} para {partner_name} (ID:{odoo_partner_id})")
        return {
            "clabe": acno.number,
            "account_number_id": acno.id,
            "odoo_partner_id": odoo_partner_id,
            "partner_name": partner_name,
        }

    def list_clabes(self) -> list[dict]:
        """Lista todas las CLABEs virtuales."""
        clabes = list(self.client.v2.account_numbers.list(account_id=self.account_id))
        return [
            {
                "clabe": acno.number,
                "account_number_id": acno.id,
                "metadata": acno.metadata or {},
            }
            for acno in clabes
        ]

    def get_clabe_by_partner(self, odoo_partner_id: int) -> str | None:
        """Busca la CLABE asignada a un partner de Odoo."""
        for acno in self.client.v2.account_numbers.list(account_id=self.account_id):
            if acno.metadata.get("odoo_partner_id") == str(odoo_partner_id):
                return acno.number
        return None

    def delete_clabe(self, account_number_id: str) -> bool:
        """Elimina una CLABE virtual."""
        try:
            self.client.v2.account_numbers.delete(account_number_id)
            return True
        except Exception as e:
            logger.error(f"Error eliminando CLABE {account_number_id}: {e}")
            return False

    # ── Transferencias Salientes (Payouts SPEI) ──

    def send_transfer(
        self,
        clabe_destino: str,
        amount_mxn: float,
        comment: str = "",
        reference_id: str = "",
        idempotency_key: str | None = None,
        metadata: dict | None = None,
    ) -> dict:
        """Envía pago SPEI a una CLABE destino."""
        amount_centavos = int(round(amount_mxn * 100))
        idem_key = idempotency_key or str(uuid_lib.uuid4())

        transfer = self.client.v2.transfers.create(
            idempotency_key=idem_key,
            amount=amount_centavos,
            currency="MXN",
            account_id=self.account_id,
            comment=comment[:40] if comment else "",
            reference_id=reference_id,
            counterparty={"account_number": clabe_destino},
            metadata=metadata or {"reference_id": reference_id},
        )
        logger.info(
            f"Transfer enviado: {transfer.id} → {clabe_destino} "
            f"${amount_mxn:.2f} MXN (status={transfer.status})"
        )
        return {
            "transfer_id": transfer.id,
            "status": transfer.status,
            "tracking_key": getattr(transfer, "tracking_key", None),
            "receipt_url": getattr(transfer, "receipt_url", None),
            "idempotency_key": idem_key,
        }

    def get_transfer(self, transfer_id: str) -> dict:
        """Obtiene detalles de una transferencia."""
        t = self.client.v2.transfers.get(transfer_id)
        return {
            "transfer_id": t.id,
            "status": t.status,
            "amount": getattr(t, "amount", 0),
            "currency": getattr(t, "currency", "MXN"),
            "tracking_key": getattr(t, "tracking_key", None),
            "counterparty": getattr(t, "counterparty", None),
            "created_at": getattr(t, "created_at", None),
        }

    def list_transfers(self, limit: int = 50) -> list[dict]:
        """Lista transferencias recientes."""
        transfers = list(self.client.v2.transfers.list(account_id=self.account_id))
        return [
            {
                "transfer_id": t.id,
                "status": t.status,
                "amount": getattr(t, "amount", 0) / 100,
                "direction": getattr(t, "direction", ""),
                "tracking_key": getattr(t, "tracking_key", None),
                "created_at": getattr(t, "created_at", None),
            }
            for t in transfers[:limit]
        ]

    # ── Verificación de CLABEs ──

    def verify_clabe(self, clabe: str) -> dict:
        """Verifica titular de una CLABE ($0.01 MXN)."""
        v = self.client.v2.account_verifications.create(account_number=clabe)
        logger.info(f"Verificación de CLABE iniciada: {v.id} → {clabe}")
        return {
            "verification_id": v.id,
            "status": v.status,
        }

    # ── Checkout Sessions (Cobros en línea) ──

    def create_checkout_session(
        self,
        amount_mxn: float,
        success_url: str,
        cancel_url: str | None = None,
        customer_email: str | None = None,
        customer_name: str | None = None,
        metadata: dict | None = None,
    ) -> dict:
        """
        Crea una sesión de checkout para cobrar en línea vía Fintoc.
        El cliente es redirigido a la página de pago de Fintoc.
        """
        amount_centavos = int(round(amount_mxn * 100))
        params: dict[str, Any] = {
            "amount": amount_centavos,
            "currency": "MXN",
            "success_url": success_url,
        }
        if cancel_url:
            params["cancel_url"] = cancel_url
        if customer_email:
            params["email"] = customer_email
        if customer_name:
            params["name"] = customer_name
        if metadata:
            params["metadata"] = metadata

        try:
            session = self.client.v2.checkout_sessions.create(**params)
            return {
                "session_id": session.id,
                "redirect_url": getattr(session, "redirect_url", ""),
                "status": session.status,
            }
        except Exception as e:
            logger.error(f"Error creando checkout session: {e}")
            return {"error": str(e)}

    # ── Data Aggregation (Movimientos) ──

    def get_account_balance(self) -> dict:
        """Obtiene balance de la cuenta principal."""
        try:
            accounts = list(self.client.v2.accounts.list())
            for acc in accounts:
                if acc.id == self.account_id:
                    return {
                        "account_id": acc.id,
                        "balance": getattr(acc, "balance", 0) / 100,
                        "currency": getattr(acc, "currency", "MXN"),
                        "name": getattr(acc, "name", ""),
                    }
            if accounts:
                acc = accounts[0]
                return {
                    "account_id": acc.id,
                    "balance": getattr(acc, "balance", 0) / 100,
                    "currency": getattr(acc, "currency", "MXN"),
                    "name": getattr(acc, "name", ""),
                }
        except Exception as e:
            logger.error(f"Error obteniendo balance: {e}")
        return {"account_id": self.account_id, "balance": 0, "currency": "MXN"}

    def get_movements(self, days: int = 30, limit: int = 100) -> list[dict]:
        """Obtiene movimientos bancarios recientes."""
        try:
            movements = list(
                self.client.v2.movements.list(account_id=self.account_id)
            )
            return [
                {
                    "id": m.id,
                    "amount": getattr(m, "amount", 0) / 100,
                    "description": getattr(m, "description", ""),
                    "post_date": getattr(m, "post_date", ""),
                    "type": getattr(m, "type", ""),
                }
                for m in movements[:limit]
            ]
        except Exception as e:
            logger.warning(f"Error obteniendo movimientos: {e}")
            return []

    # ── Webhooks ──

    def create_webhook_endpoint(
        self, url: str, events: list[str], description: str = ""
    ) -> dict:
        """Registra un endpoint de webhooks en Fintoc."""
        try:
            endpoint = self.client.webhook_endpoints.create(
                url=url,
                enabled_events=events,
                description=description,
            )
            return {
                "endpoint_id": endpoint.id,
                "url": url,
                "events": events,
                "status": "active",
            }
        except Exception as e:
            logger.error(f"Error creando webhook endpoint: {e}")
            return {"error": str(e)}

    def list_webhook_endpoints(self) -> list[dict]:
        """Lista endpoints de webhooks registrados."""
        try:
            endpoints = list(self.client.webhook_endpoints.list())
            return [
                {
                    "id": ep.id,
                    "url": getattr(ep, "url", ""),
                    "enabled_events": getattr(ep, "enabled_events", []),
                    "status": getattr(ep, "status", ""),
                }
                for ep in endpoints
            ]
        except Exception as e:
            logger.error(f"Error listando webhooks: {e}")
            return []

    # ── Simulación (Test Mode) ──

    def simulate_inbound_transfer(
        self, account_number_id: str, amount_mxn: float, comment: str = "Pago simulado"
    ) -> dict:
        """Simula un cobro entrante (solo sk_test_*)."""
        result = self.client.v2.simulate.receive_transfer(
            account_number_id=account_number_id,
            amount=int(round(amount_mxn * 100)),
            currency="MXN",
            comment=comment,
        )
        return {"transfer_id": result.id, "status": result.status}


# Singleton
_fintoc_service: FintocService | None = None


def get_fintoc_service() -> FintocService:
    global _fintoc_service
    if _fintoc_service is None:
        _fintoc_service = FintocService()
    return _fintoc_service
