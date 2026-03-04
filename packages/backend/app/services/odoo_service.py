"""
Servicio Odoo mejorado: integración profunda con Odoo 17/18/19 vía XML-RPC.

Soporta:
- Clientes y proveedores (res.partner)
- Facturas de venta y compra (account.move)
- Pagos (account.payment)
- CFDI / EDI México (l10n_mx_edi)
- Diarios contables (account.journal)
- Cuentas analíticas / presupuestos
- Gastos (hr.expense)
- Conciliación bancaria
- Notas internas y chatter
- Multi-empresa
"""

import logging
import xmlrpc.client
from datetime import datetime, timedelta
from typing import Any, Optional

from app.config import get_settings

logger = logging.getLogger(__name__)


class OdooService:
    """Cliente XML-RPC completo para Odoo."""

    def __init__(self):
        settings = get_settings()
        self.url = settings.odoo_url
        self.db = settings.odoo_database
        self._user = settings.odoo_username
        self._password = settings.odoo_password
        common = xmlrpc.client.ServerProxy(f"{self.url}/xmlrpc/2/common")
        self.uid = common.authenticate(self.db, self._user, self._password, {})
        self.models = xmlrpc.client.ServerProxy(f"{self.url}/xmlrpc/2/object")
        logger.info(f"Conectado a Odoo: {self.url} (uid={self.uid})")

    def _call(self, model: str, method: str, args: list, kwargs: dict | None = None):
        return self.models.execute_kw(
            self.db, self.uid, self._password, model, method, args, kwargs or {}
        )

    # ══════════════════════════════════════════════════════════════
    # CLIENTES
    # ══════════════════════════════════════════════════════════════

    def get_all_customers(self, limit: int = 0) -> list[dict]:
        kwargs: dict = {"fields": ["id", "name", "vat", "ref", "email", "phone", "city", "state_id", "country_id"]}
        if limit:
            kwargs["limit"] = limit
        return self._call(
            "res.partner", "search_read",
            [[["customer_rank", ">", 0], ["active", "=", True]]],
            kwargs,
        )

    def get_customer(self, partner_id: int) -> dict | None:
        result = self._call(
            "res.partner", "read", [[partner_id]],
            {"fields": ["id", "name", "vat", "ref", "email", "phone", "bank_ids",
                         "property_payment_term_id", "property_supplier_payment_term_id"]},
        )
        return result[0] if result else None

    def search_customers(self, query: str) -> list[dict]:
        return self._call(
            "res.partner", "search_read",
            [["|", "|", ["name", "ilike", query], ["vat", "ilike", query], ["ref", "ilike", query],
              ["customer_rank", ">", 0]]],
            {"fields": ["id", "name", "vat", "ref", "email"], "limit": 50},
        )

    # ══════════════════════════════════════════════════════════════
    # PROVEEDORES
    # ══════════════════════════════════════════════════════════════

    def get_all_vendors(self, limit: int = 0) -> list[dict]:
        kwargs: dict = {"fields": ["id", "name", "vat", "ref", "email", "bank_ids"]}
        if limit:
            kwargs["limit"] = limit
        return self._call(
            "res.partner", "search_read",
            [[["supplier_rank", ">", 0], ["active", "=", True]]],
            kwargs,
        )

    def get_vendor(self, partner_id: int) -> dict | None:
        result = self._call(
            "res.partner", "read", [[partner_id]],
            {"fields": ["id", "name", "vat", "ref", "email", "bank_ids",
                         "property_supplier_payment_term_id"]},
        )
        return result[0] if result else None

    def get_vendor_clabe(self, partner_id: int) -> str | None:
        banks = self._call(
            "res.partner.bank", "search_read",
            [[["partner_id", "=", partner_id]]],
            {"fields": ["acc_number", "bank_name"], "limit": 1},
        )
        return banks[0]["acc_number"] if banks else None

    def set_vendor_clabe(self, partner_id: int, clabe: str, bank_name: str = "") -> int:
        return self._call(
            "res.partner.bank", "create",
            [{"partner_id": partner_id, "acc_number": clabe, "bank_name": bank_name}],
        )

    # ══════════════════════════════════════════════════════════════
    # FACTURAS DE VENTA (Accounts Receivable)
    # ══════════════════════════════════════════════════════════════

    def get_pending_invoices(self, partner_id: int | None = None, limit: int = 200) -> list[dict]:
        domain = [
            ["move_type", "=", "out_invoice"],
            ["payment_state", "in", ["not_paid", "partial"]],
            ["state", "=", "posted"],
        ]
        if partner_id:
            domain.append(["partner_id", "=", partner_id])
        return self._call(
            "account.move", "search_read", [domain],
            {"fields": ["id", "name", "partner_id", "amount_total", "amount_residual",
                         "invoice_date", "invoice_date_due", "l10n_mx_edi_cfdi_uuid",
                         "l10n_mx_edi_payment_policy"],
             "order": "invoice_date_due asc", "limit": limit},
        )

    def get_overdue_invoices(self, days_overdue: int = 0) -> list[dict]:
        cutoff = (datetime.now() - timedelta(days=days_overdue)).strftime("%Y-%m-%d")
        return self._call(
            "account.move", "search_read",
            [[
                ["move_type", "=", "out_invoice"],
                ["payment_state", "in", ["not_paid", "partial"]],
                ["state", "=", "posted"],
                ["invoice_date_due", "<", cutoff],
            ]],
            {"fields": ["id", "name", "partner_id", "amount_total", "amount_residual",
                         "invoice_date_due"],
             "order": "invoice_date_due asc"},
        )

    def get_invoice(self, invoice_id: int) -> dict | None:
        result = self._call(
            "account.move", "read", [[invoice_id]],
            {"fields": ["id", "name", "partner_id", "move_type", "state",
                         "amount_total", "amount_residual", "amount_untaxed", "amount_tax",
                         "invoice_date", "invoice_date_due", "payment_state",
                         "currency_id", "company_id",
                         "l10n_mx_edi_cfdi_uuid", "l10n_mx_edi_payment_policy"]},
        )
        return result[0] if result else None

    def get_invoice_by_name(self, name: str, move_type: str = "out_invoice") -> dict | None:
        result = self._call(
            "account.move", "search_read",
            [[["name", "=", name], ["move_type", "=", move_type]]],
            {"fields": ["id", "name", "partner_id", "amount_total", "amount_residual",
                         "currency_id", "l10n_mx_edi_cfdi_uuid"],
             "limit": 1},
        )
        return result[0] if result else None

    # ══════════════════════════════════════════════════════════════
    # FACTURAS DE COMPRA (Accounts Payable)
    # ══════════════════════════════════════════════════════════════

    def get_pending_bills(self, partner_id: int | None = None, limit: int = 200) -> list[dict]:
        domain = [
            ["move_type", "=", "in_invoice"],
            ["payment_state", "in", ["not_paid", "partial"]],
            ["state", "=", "posted"],
        ]
        if partner_id:
            domain.append(["partner_id", "=", partner_id])
        return self._call(
            "account.move", "search_read", [domain],
            {"fields": ["id", "name", "partner_id", "amount_total", "amount_residual",
                         "invoice_date", "invoice_date_due", "ref",
                         "l10n_mx_edi_cfdi_uuid", "l10n_mx_edi_payment_policy"],
             "order": "invoice_date_due asc", "limit": limit},
        )

    def get_overdue_bills(self, days_overdue: int = 0) -> list[dict]:
        cutoff = (datetime.now() - timedelta(days=days_overdue)).strftime("%Y-%m-%d")
        return self._call(
            "account.move", "search_read",
            [[
                ["move_type", "=", "in_invoice"],
                ["payment_state", "in", ["not_paid", "partial"]],
                ["state", "=", "posted"],
                ["invoice_date_due", "<", cutoff],
            ]],
            {"fields": ["id", "name", "partner_id", "amount_total", "amount_residual",
                         "invoice_date_due"],
             "order": "invoice_date_due asc"},
        )

    def get_bill(self, bill_id: int) -> dict | None:
        return self.get_invoice(bill_id)

    def get_bill_by_name(self, name: str) -> dict | None:
        return self.get_invoice_by_name(name, move_type="in_invoice")

    # ══════════════════════════════════════════════════════════════
    # PAGOS
    # ══════════════════════════════════════════════════════════════

    def _get_fintoc_journal_id(self) -> int:
        journals = self._call(
            "account.journal", "search_read",
            [[["name", "ilike", "fintoc"]]],
            {"fields": ["id", "name"], "limit": 1},
        )
        return journals[0]["id"] if journals else 1

    def _get_payment_method_transfer(self) -> int | None:
        try:
            ids = self._call("l10n_mx_edi.payment.method", "search", [[["code", "=", "03"]]])
            return ids[0] if ids else None
        except Exception:
            return None

    def register_payment(
        self, invoice_id: int, amount: float, memo: str = "",
        journal_id: int | None = None, payment_method_id: int | None = None,
    ) -> bool:
        if not journal_id:
            journal_id = self._get_fintoc_journal_id()
        vals: dict[str, Any] = {"amount": amount, "memo": memo, "journal_id": journal_id}
        if payment_method_id is None:
            payment_method_id = self._get_payment_method_transfer()
        if payment_method_id:
            vals["l10n_mx_edi_payment_method_id"] = payment_method_id
        ctx = {"active_model": "account.move", "active_ids": [invoice_id]}
        wizard_id = self._call("account.payment.register", "create", [vals], {"context": ctx})
        self._call("account.payment.register", "action_create_payments", [[wizard_id]], {"context": ctx})
        logger.info(f"Pago registrado: invoice={invoice_id} amount={amount}")
        return True

    def register_vendor_payment(
        self, bill_id: int, amount: float, memo: str = "",
        journal_id: int | None = None, payment_method_id: int | None = None,
    ) -> bool:
        return self.register_payment(bill_id, amount, memo, journal_id, payment_method_id)

    def get_last_payment_for_invoice(self, invoice_id: int) -> int | None:
        try:
            ids = self._call(
                "account.payment", "search",
                [[["reconciled_invoice_ids", "in", [invoice_id]]]],
                {"order": "id desc", "limit": 1},
            )
            return ids[0] if ids else None
        except Exception:
            return None

    # ══════════════════════════════════════════════════════════════
    # CFDI / EDI México
    # ══════════════════════════════════════════════════════════════

    def get_invoice_cfdi_data(self, invoice_id: int) -> dict | None:
        fields = [
            "id", "name", "move_type", "amount_total", "amount_residual",
            "partner_id", "company_id",
            "l10n_mx_edi_cfdi_uuid", "l10n_mx_edi_payment_policy",
        ]
        try:
            rows = self._call("account.move", "read", [[invoice_id]], {"fields": fields})
        except Exception:
            return None
        if not rows:
            return None
        inv = rows[0]
        partner_id = inv["partner_id"][0] if isinstance(inv["partner_id"], (list, tuple)) else inv["partner_id"]
        company_id = inv["company_id"][0] if isinstance(inv["company_id"], (list, tuple)) else inv["company_id"]
        partner = self.get_customer(partner_id) or self.get_vendor(partner_id)
        company = self._call("res.company", "read", [[company_id]], {"fields": ["vat", "name"]})
        company_vat = (company[0].get("vat") or "").strip() if company else ""
        partner_vat = (partner.get("vat") or "").strip() if partner else ""
        return {
            "invoice_id": invoice_id,
            "name": inv.get("name"),
            "move_type": inv.get("move_type"),
            "amount_total": inv.get("amount_total"),
            "amount_residual": inv.get("amount_residual"),
            "uuid": (inv.get("l10n_mx_edi_cfdi_uuid") or "").strip(),
            "payment_policy": inv.get("l10n_mx_edi_payment_policy") or "",
            "rfc_emisor": company_vat if inv.get("move_type") == "out_invoice" else partner_vat,
            "rfc_receptor": partner_vat if inv.get("move_type") == "out_invoice" else company_vat,
            "partner_id": partner_id,
        }

    def get_vendor_bill_cfdi(self, bill_id: int) -> dict | None:
        data = self.get_invoice_cfdi_data(bill_id)
        if data is None or data.get("move_type") != "in_invoice":
            return None
        return data

    def get_payment_cfdi_status(self, payment_id: int) -> dict | None:
        fields = [
            "id", "name", "amount", "state",
            "l10n_mx_edi_cfdi_uuid", "l10n_mx_edi_sat_status", "l10n_mx_edi_document_ids",
        ]
        try:
            rows = self._call("account.payment", "read", [[payment_id]], {"fields": fields})
        except Exception:
            return None
        if not rows:
            return None
        p = rows[0]
        return {
            "payment_id": payment_id,
            "name": p.get("name"),
            "uuid": (p.get("l10n_mx_edi_cfdi_uuid") or "").strip(),
            "sat_status": p.get("l10n_mx_edi_sat_status") or "none",
            "document_ids": p.get("l10n_mx_edi_document_ids") or [],
            "state": p.get("state"),
        }

    def get_payment_cfdi_xml(self, payment_id: int) -> list[dict]:
        try:
            attachments = self._call(
                "ir.attachment", "search_read",
                [[
                    ["res_model", "=", "account.payment"],
                    ["res_id", "=", payment_id],
                    "|", ["name", "ilike", ".xml"], ["name", "ilike", ".pdf"],
                ]],
                {"fields": ["id", "name", "datas", "mimetype"]},
            )
        except Exception:
            return []
        return [{"name": a["name"], "datas": a.get("datas"), "mimetype": a.get("mimetype")} for a in attachments]

    def update_sat_status(self, move_id: int, model: str = "account.move") -> str | None:
        try:
            self._call(model, "l10n_mx_edi_update_sat_status", [[move_id]])
            rows = self._call(model, "read", [[move_id]], {"fields": ["l10n_mx_edi_sat_status"]})
            return rows[0].get("l10n_mx_edi_sat_status") if rows else None
        except Exception:
            return None

    # ══════════════════════════════════════════════════════════════
    # PAGOS FINTOC (para conciliación)
    # ══════════════════════════════════════════════════════════════

    def get_payments_fintoc(self, days: int = 7) -> list[dict]:
        date_from = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
        try:
            journal_ids = self._call("account.journal", "search", [[["name", "ilike", "fintoc"]]])
            if not journal_ids:
                return []
            payment_ids = self._call(
                "account.payment", "search",
                [[["journal_id", "in", journal_ids], ["date", ">=", date_from], ["state", "=", "posted"]]],
                {"order": "date desc, id desc"},
            )
            if not payment_ids:
                return []
            return self._call(
                "account.payment", "read", [payment_ids],
                {"fields": ["id", "name", "amount", "date", "ref", "journal_id",
                             "reconciled_invoice_ids", "l10n_mx_edi_cfdi_uuid", "l10n_mx_edi_sat_status"]},
            )
        except Exception:
            return []

    # ══════════════════════════════════════════════════════════════
    # GASTOS (hr.expense)
    # ══════════════════════════════════════════════════════════════

    def create_expense(
        self, employee_id: int, name: str, amount: float,
        product_id: int | None = None, company_id: int | None = None,
    ) -> int:
        vals: dict[str, Any] = {
            "employee_id": employee_id,
            "name": name,
            "total_amount": amount,
        }
        if product_id:
            vals["product_id"] = product_id
        if company_id:
            vals["company_id"] = company_id
        return self._call("hr.expense", "create", [vals])

    def get_pending_expenses(self, employee_id: int | None = None) -> list[dict]:
        domain: list = [["state", "in", ["draft", "reported"]]]
        if employee_id:
            domain.append(["employee_id", "=", employee_id])
        return self._call(
            "hr.expense", "search_read", [domain],
            {"fields": ["id", "name", "employee_id", "total_amount", "state", "date"]},
        )

    # ══════════════════════════════════════════════════════════════
    # CUENTAS ANALÍTICAS / PRESUPUESTOS
    # ══════════════════════════════════════════════════════════════

    def get_analytic_accounts(self, company_id: int | None = None) -> list[dict]:
        domain: list = [["active", "=", True]]
        if company_id:
            domain.append(["company_id", "=", company_id])
        try:
            return self._call(
                "account.analytic.account", "search_read", [domain],
                {"fields": ["id", "name", "code", "balance", "debit", "credit"]},
            )
        except Exception:
            return []

    # ══════════════════════════════════════════════════════════════
    # MULTI-EMPRESA
    # ══════════════════════════════════════════════════════════════

    def get_companies(self) -> list[dict]:
        return self._call(
            "res.company", "search_read", [[]],
            {"fields": ["id", "name", "vat", "currency_id"]},
        )

    # ══════════════════════════════════════════════════════════════
    # AGING (Antigüedad de saldos)
    # ══════════════════════════════════════════════════════════════

    def get_aging_receivable(self) -> dict:
        """Calcula antigüedad de saldos por cobrar."""
        invoices = self._call(
            "account.move", "search_read",
            [[["move_type", "=", "out_invoice"], ["payment_state", "in", ["not_paid", "partial"]], ["state", "=", "posted"]]],
            {"fields": ["id", "name", "partner_id", "amount_residual", "invoice_date_due"]},
        )
        return self._calculate_aging(invoices)

    def get_aging_payable(self) -> dict:
        """Calcula antigüedad de saldos por pagar."""
        bills = self._call(
            "account.move", "search_read",
            [[["move_type", "=", "in_invoice"], ["payment_state", "in", ["not_paid", "partial"]], ["state", "=", "posted"]]],
            {"fields": ["id", "name", "partner_id", "amount_residual", "invoice_date_due"]},
        )
        return self._calculate_aging(bills)

    def _calculate_aging(self, invoices: list[dict]) -> dict:
        today = datetime.now().date()
        buckets = {"current": 0, "1_30": 0, "31_60": 0, "61_90": 0, "over_90": 0}
        details = []
        for inv in invoices:
            due = inv.get("invoice_date_due")
            residual = inv.get("amount_residual", 0)
            if not due:
                buckets["current"] += residual
                continue
            if isinstance(due, str):
                due_date = datetime.strptime(due, "%Y-%m-%d").date()
            else:
                due_date = due
            days = (today - due_date).days
            if days <= 0:
                buckets["current"] += residual
            elif days <= 30:
                buckets["1_30"] += residual
            elif days <= 60:
                buckets["31_60"] += residual
            elif days <= 90:
                buckets["61_90"] += residual
            else:
                buckets["over_90"] += residual
            partner = inv.get("partner_id")
            details.append({
                "invoice_id": inv["id"],
                "name": inv.get("name"),
                "partner": partner[1] if isinstance(partner, (list, tuple)) else str(partner),
                "amount_residual": residual,
                "due_date": str(due),
                "days_overdue": max(0, days),
            })
        total = sum(buckets.values())
        return {**buckets, "total": total, "details": details}

    # ══════════════════════════════════════════════════════════════
    # NOTAS / CHATTER
    # ══════════════════════════════════════════════════════════════

    def post_message(self, model: str, record_id: int, body: str, message_type: str = "comment"):
        try:
            self._call(model, "message_post", [[record_id]], {"body": body, "message_type": message_type})
        except Exception as e:
            logger.warning(f"Error posting message: {e}")

    def log_fintoc_event(self, event_id: str, event_type: str, data: dict):
        logger.info(f"[FINTOC EVENT] {event_id} | {event_type} | {data}")


# Singleton
_odoo_service: OdooService | None = None


def get_odoo_service() -> OdooService:
    global _odoo_service
    if _odoo_service is None:
        _odoo_service = OdooService()
    return _odoo_service
