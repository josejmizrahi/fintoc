"""
Servicio de Cuentas por Cobrar (Accounts Receivable / Collections).

Funcionalidades:
- Gestión de cobranza con recordatorios automáticos
- Generación de links de pago (Checkout Sessions)
- CLABEs virtuales por cliente
- Seguimiento de facturas vencidas
- Reconciliación automática de cobros
- Aging de cartera por cobrar
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from app.config import get_settings

logger = logging.getLogger(__name__)


class CollectionService:
    """Servicio de cobranza y cuentas por cobrar."""

    def __init__(self, fintoc_service, odoo_service):
        self.fintoc = fintoc_service
        self.odoo = odoo_service

    def get_pending_collections(self, partner_id: int | None = None) -> list[dict]:
        """Lista facturas pendientes de cobro con detalle de cliente."""
        invoices = self.odoo.get_pending_invoices(partner_id=partner_id)
        collections = []
        for inv in invoices:
            partner = inv.get("partner_id")
            partner_name = partner[1] if isinstance(partner, (list, tuple)) else str(partner)
            partner_id_val = partner[0] if isinstance(partner, (list, tuple)) else partner
            collections.append({
                "invoice_id": inv["id"],
                "invoice_name": inv.get("name"),
                "partner_id": partner_id_val,
                "partner_name": partner_name,
                "amount_total": inv.get("amount_total", 0),
                "amount_residual": inv.get("amount_residual", 0),
                "date_due": inv.get("invoice_date_due"),
                "cfdi_uuid": inv.get("l10n_mx_edi_cfdi_uuid"),
                "payment_policy": inv.get("l10n_mx_edi_payment_policy"),
            })
        return collections

    def get_overdue_collections(self, days_overdue: int = 0) -> list[dict]:
        """Lista facturas vencidas."""
        invoices = self.odoo.get_overdue_invoices(days_overdue=days_overdue)
        return [
            {
                "invoice_id": inv["id"],
                "invoice_name": inv.get("name"),
                "partner_id": inv["partner_id"][0] if isinstance(inv.get("partner_id"), (list, tuple)) else inv.get("partner_id"),
                "partner_name": inv["partner_id"][1] if isinstance(inv.get("partner_id"), (list, tuple)) else "",
                "amount_residual": inv.get("amount_residual", 0),
                "date_due": inv.get("invoice_date_due"),
            }
            for inv in invoices
        ]

    def get_collection_summary(self, partner_id: int) -> dict:
        """Resumen de cobranza para un cliente específico."""
        customer = self.odoo.get_customer(partner_id)
        if not customer:
            return {"error": "Cliente no encontrado"}

        invoices = self.odoo.get_pending_invoices(partner_id=partner_id)
        clabe = self.fintoc.get_clabe_by_partner(partner_id)
        total_pending = sum(inv.get("amount_residual", 0) for inv in invoices)

        return {
            "partner_id": partner_id,
            "partner_name": customer.get("name", ""),
            "partner_rfc": customer.get("vat", ""),
            "clabe": clabe,
            "pending_invoices": len(invoices),
            "total_pending": total_pending,
            "invoices": [
                {
                    "id": inv["id"],
                    "name": inv.get("name"),
                    "amount_residual": inv.get("amount_residual", 0),
                    "date_due": inv.get("invoice_date_due"),
                }
                for inv in invoices
            ],
        }

    def setup_customer_clabe(self, partner_id: int) -> dict:
        """Crea o retorna la CLABE virtual de un cliente."""
        existing = self.fintoc.get_clabe_by_partner(partner_id)
        if existing:
            return {"clabe": existing, "status": "existing"}

        customer = self.odoo.get_customer(partner_id)
        if not customer:
            return {"error": "Cliente no encontrado en Odoo"}

        result = self.fintoc.create_clabe(partner_id, customer.get("name", ""))
        return {"clabe": result["clabe"], "status": "created"}

    def setup_all_customer_clabes(self) -> dict:
        """Crea CLABEs para todos los clientes que no tienen una."""
        customers = self.odoo.get_all_customers()
        created = []
        existing = []
        for customer in customers:
            pid = customer["id"]
            name = customer["name"]
            clabe = self.fintoc.get_clabe_by_partner(pid)
            if clabe:
                existing.append({"partner_id": pid, "name": name, "clabe": clabe})
            else:
                result = self.fintoc.create_clabe(pid, name)
                created.append({"partner_id": pid, "name": name, "clabe": result["clabe"]})

        return {
            "total_customers": len(customers),
            "created": len(created),
            "existing": len(existing),
            "new_clabes": created,
        }

    def generate_payment_link(
        self,
        partner_id: int,
        amount_mxn: float | None = None,
        invoice_id: int | None = None,
    ) -> dict:
        """Genera un link de pago Fintoc para un cliente."""
        settings = get_settings()
        customer = self.odoo.get_customer(partner_id)
        if not customer:
            return {"error": "Cliente no encontrado"}

        if not amount_mxn and invoice_id:
            invoice = self.odoo.get_invoice(invoice_id)
            if invoice:
                amount_mxn = invoice.get("amount_residual", 0)

        if not amount_mxn or amount_mxn <= 0:
            return {"error": "Monto inválido"}

        success_url = f"{settings.base_url}/payment/success"
        cancel_url = f"{settings.base_url}/payment/cancel"

        result = self.fintoc.create_checkout_session(
            amount_mxn=amount_mxn,
            success_url=success_url,
            cancel_url=cancel_url,
            customer_email=customer.get("email"),
            customer_name=customer.get("name"),
            metadata={
                "odoo_partner_id": str(partner_id),
                "odoo_invoice_id": str(invoice_id) if invoice_id else "",
            },
        )

        if "error" in result:
            return result

        return {
            "partner_id": partner_id,
            "partner_name": customer.get("name"),
            "amount": amount_mxn,
            "payment_link": result.get("redirect_url", ""),
            "session_id": result.get("session_id", ""),
        }

    def get_aging_receivable(self) -> dict:
        """Reporte de antigüedad de saldos por cobrar."""
        return self.odoo.get_aging_receivable()

    def sync_customer_clabes(self) -> dict:
        """Sincroniza CLABEs: crea para nuevos clientes, reporta huérfanas."""
        customers = self.odoo.get_all_customers()
        existing_clabes = self.fintoc.list_clabes()

        partner_ids_with_clabe = set()
        for acno in existing_clabes:
            pid = acno.get("metadata", {}).get("odoo_partner_id")
            if pid:
                partner_ids_with_clabe.add(int(pid))

        new_clabes = []
        for customer in customers:
            pid = customer["id"]
            if pid not in partner_ids_with_clabe:
                result = self.fintoc.create_clabe(pid, customer["name"])
                new_clabes.append(result)

        odoo_ids = {c["id"] for c in customers}
        orphans = [
            acno for acno in existing_clabes
            if acno.get("metadata", {}).get("odoo_partner_id")
            and int(acno["metadata"]["odoo_partner_id"]) not in odoo_ids
        ]

        return {
            "new_clabes": len(new_clabes),
            "orphan_clabes": len(orphans),
            "details": {"created": new_clabes, "orphans": orphans},
        }
