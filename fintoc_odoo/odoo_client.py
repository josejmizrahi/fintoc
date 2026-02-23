"""
Cliente XML-RPC para Odoo 19.
Operaciones necesarias para la integración con Fintoc.
"""
import xmlrpc.client
from config import ODOO_URL, ODOO_DB, ODOO_USER, ODOO_PASSWORD


class OdooClient:
    def __init__(self):
        self.url = ODOO_URL
        self.db = ODOO_DB
        common = xmlrpc.client.ServerProxy(f"{self.url}/xmlrpc/2/common")
        self.uid = common.authenticate(self.db, ODOO_USER, ODOO_PASSWORD, {})
        self.models = xmlrpc.client.ServerProxy(f"{self.url}/xmlrpc/2/object")

    def _call(self, model, method, args, kwargs=None):
        return self.models.execute_kw(
            self.db, self.uid, ODOO_PASSWORD,
            model, method, args, kwargs or {}
        )

    # ── Clientes ──────────────────────────────────────────────

    def get_all_customers(self):
        """Retorna lista de clientes activos con su ID interno y nombre."""
        return self._call(
            "res.partner", "search_read",
            [[["customer_rank", ">", 0], ["active", "=", True]]],
            {"fields": ["id", "name", "vat", "ref"]},
        )

    def get_customer_by_id(self, partner_id: int):
        result = self._call(
            "res.partner", "read", [[partner_id]],
            {"fields": ["id", "name", "vat", "ref"]},
        )
        return result[0] if result else None

    # ── Facturas ──────────────────────────────────────────────

    def get_pending_invoices(self, partner_id: int = None):
        """Retorna facturas pendientes de cobro (por cliente opcional)."""
        domain = [
            ["move_type", "=", "out_invoice"],
            ["payment_state", "in", ["not_paid", "partial"]],
        ]
        if partner_id:
            domain.append(["partner_id", "=", partner_id])
        return self._call(
            "account.move", "search_read", [domain],
            {"fields": ["id", "name", "partner_id", "amount_residual", "invoice_date_due"]},
        )

    def get_invoice_by_name(self, invoice_name: str):
        """Busca factura por número (ej: 'INV/2026/0042')."""
        result = self._call(
            "account.move", "search_read",
            [[["name", "=", invoice_name], ["move_type", "=", "out_invoice"]]],
            {"fields": ["id", "name", "partner_id", "amount_residual", "currency_id"]},
        )
        return result[0] if result else None

    def get_bill_by_name(self, bill_name: str):
        """Busca factura de proveedor por número (ej: 'BILL/2026/0042')."""
        result = self._call(
            "account.move", "search_read",
            [[["name", "=", bill_name], ["move_type", "=", "in_invoice"]]],
            {"fields": ["id", "name", "partner_id", "amount_residual", "amount_total"]},
        )
        return result[0] if result else None

    # ── Registrar pago recibido ────────────────────────────────

    def _get_payment_method_transfer(self) -> int | None:
        """Obtiene el ID del método de pago SAT '03' (Transferencia electrónica) si existe."""
        try:
            # l10n_mx_edi: modelo l10n_mx_edi.payment.method o similar con code '03'
            ids = self._call(
                "l10n_mx_edi.payment.method", "search",
                [[["code", "=", "03"]]],
            )
            if ids:
                return ids[0]
        except Exception:
            pass
        return None

    def register_payment(
        self,
        invoice_id: int,
        amount: float,
        memo: str = "",
        journal_id: int = None,
        payment_method_id: int | None = None,
    ):
        """
        Registra un pago sobre una factura en Odoo.
        journal_id: ID del diario bancario de Fintoc (configurar en Odoo).
        payment_method_id: ID de l10n_mx_edi.payment.method (ej. 03 Transferencia) para Complemento de Pago.
        """
        if not journal_id:
            journals = self._call(
                "account.journal", "search_read",
                [[["name", "ilike", "fintoc"]]],
                {"fields": ["id", "name"]},
            )
            journal_id = journals[0]["id"] if journals else 1

        vals = {"amount": amount, "memo": memo, "journal_id": journal_id}
        if payment_method_id is None:
            payment_method_id = self._get_payment_method_transfer()
        if payment_method_id:
            vals["l10n_mx_edi_payment_method_id"] = payment_method_id

        wizard_id = self._call(
            "account.payment.register", "create",
            [vals],
            {"context": {"active_model": "account.move", "active_ids": [invoice_id]}},
        )

        self._call(
            "account.payment.register", "action_create_payments",
            [[wizard_id]],
            {"context": {"active_model": "account.move", "active_ids": [invoice_id]}},
        )
        return True

    def register_vendor_payment(
        self,
        bill_id: int,
        amount: float,
        memo: str = "",
        journal_id: int = None,
        payment_method_id: int | None = None,
    ):
        """
        Registra un pago sobre una factura de proveedor (in_invoice).
        Usado cuando Fintoc confirma un pago outbound (transfer.outbound.succeeded).
        """
        if not journal_id:
            journals = self._call(
                "account.journal", "search_read",
                [[["name", "ilike", "fintoc"]]],
                {"fields": ["id", "name"]},
            )
            journal_id = journals[0]["id"] if journals else 1

        vals = {"amount": amount, "memo": memo, "journal_id": journal_id}
        if payment_method_id is None:
            payment_method_id = self._get_payment_method_transfer()
        if payment_method_id:
            vals["l10n_mx_edi_payment_method_id"] = payment_method_id

        wizard_id = self._call(
            "account.payment.register", "create",
            [vals],
            {"context": {"active_model": "account.move", "active_ids": [bill_id]}},
        )
        self._call(
            "account.payment.register", "action_create_payments",
            [[wizard_id]],
            {"context": {"active_model": "account.move", "active_ids": [bill_id]}},
        )
        return True

    # ── Proveedores ────────────────────────────────────────────

    def get_vendor_by_id(self, partner_id: int):
        result = self._call(
            "res.partner", "read", [[partner_id]],
            {"fields": ["id", "name", "vat", "bank_ids"]},
        )
        return result[0] if result else None

    def get_vendor_clabe(self, partner_id: int):
        """Retorna la CLABE del proveedor desde sus cuentas bancarias en Odoo."""
        banks = self._call(
            "res.partner.bank", "search_read",
            [[["partner_id", "=", partner_id]]],
            {"fields": ["acc_number", "bank_name"]},
        )
        return banks[0]["acc_number"] if banks else None

    # ── CFDI / EDI México (l10n_mx_edi) ──────────────────────────

    def get_invoice_cfdi_data(self, invoice_id: int) -> dict | None:
        """
        Obtiene UUID, RFC emisor/receptor, total y política de pago de una factura (cliente o proveedor).
        """
        fields = [
            "id", "name", "move_type", "amount_total", "amount_residual",
            "partner_id", "company_id",
            "l10n_mx_edi_cfdi_uuid",
            "l10n_mx_edi_payment_policy",
        ]
        try:
            rows = self._call(
                "account.move", "read", [[invoice_id]],
                {"fields": fields},
            )
        except Exception:
            return None
        if not rows:
            return None
        inv = rows[0]
        # partner_id y company_id pueden ser [id, name]
        partner_id = inv["partner_id"][0] if isinstance(inv["partner_id"], (list, tuple)) else inv["partner_id"]
        company_id = inv["company_id"][0] if isinstance(inv["company_id"], (list, tuple)) else inv["company_id"]
        partner = self.get_customer_by_id(partner_id) or self.get_vendor_by_id(partner_id)
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

    def get_payment_cfdi_status(self, payment_id: int) -> dict | None:
        """Verifica si el Complemento de Pago se timbró correctamente (UUID y estado SAT)."""
        fields = [
            "id", "name", "amount", "state",
            "l10n_mx_edi_cfdi_uuid",
            "l10n_mx_edi_sat_status",
            "l10n_mx_edi_document_ids",
        ]
        try:
            rows = self._call(
                "account.payment", "read", [[payment_id]],
                {"fields": fields},
            )
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
        """Descarga XML/PDF del complemento timbrado desde ir.attachment."""
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
        return [
            {"name": a["name"], "datas": a.get("datas"), "mimetype": a.get("mimetype")}
            for a in attachments
        ]

    def get_vendor_bill_cfdi(self, bill_id: int) -> dict | None:
        """Extrae UUID y datos fiscales de una factura de proveedor para validar contra SAT."""
        data = self.get_invoice_cfdi_data(bill_id)
        if data is None or data.get("move_type") != "in_invoice":
            return None
        return data

    def update_sat_status(self, move_id: int, model: str = "account.move") -> str | None:
        """Refresca el estado SAT del CFDI en Odoo (account.move o account.payment)."""
        try:
            self._call(
                model, "l10n_mx_edi_update_sat_status",
                [[move_id]],
            )
            rows = self._call(
                model, "read", [[move_id]],
                {"fields": ["l10n_mx_edi_sat_status"]},
            )
            return rows[0].get("l10n_mx_edi_sat_status") if rows else None
        except Exception:
            return None

    def get_last_payment_for_invoice(self, invoice_id: int) -> int | None:
        """Obtiene el ID del último pago reconciliado con la factura (para verificar complemento)."""
        try:
            payment_ids = self._call(
                "account.payment", "search",
                [[["reconciled_invoice_ids", "in", [invoice_id]]]],
                {"order": "id desc", "limit": 1},
            )
            return payment_ids[0] if payment_ids else None
        except Exception:
            return None

    def get_payments_fintoc(self, days: int = 7):
        """
        Lista pagos del diario Fintoc en los últimos N días (para conciliación SAT).
        Returns list of dicts with id, name, amount, date, reconciled_invoice_ids, etc.
        """
        from datetime import datetime, timedelta
        date_from = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
        try:
            journal_ids = self._call(
                "account.journal", "search",
                [[["name", "ilike", "fintoc"]]],
            )
            if not journal_ids:
                return []
            payment_ids = self._call(
                "account.payment", "search",
                [[
                    ["journal_id", "in", journal_ids],
                    ["date", ">=", date_from],
                    ["state", "=", "posted"],
                ]],
                {"order": "date desc, id desc"},
            )
            if not payment_ids:
                return []
            return self._call(
                "account.payment", "read", [payment_ids],
                {"fields": ["id", "name", "amount", "date", "ref", "journal_id", "reconciled_invoice_ids", "l10n_mx_edi_cfdi_uuid", "l10n_mx_edi_sat_status"]},
            )
        except Exception:
            return []

    # ── Log de eventos Fintoc ──────────────────────────────────

    def log_fintoc_event(self, event_id: str, event_type: str, data: dict):
        """Guarda el evento Fintoc como nota interna en Odoo."""
        print(f"[FINTOC LOG] {event_id} | {event_type} | {data}")
