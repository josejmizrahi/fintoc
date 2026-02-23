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

    # ── Registrar pago recibido ────────────────────────────────

    def register_payment(self, invoice_id: int, amount: float, memo: str = "", journal_id: int = None):
        """
        Registra un pago sobre una factura en Odoo.
        journal_id: ID del diario bancario de Fintoc (configurar en Odoo).
        """
        if not journal_id:
            journals = self._call(
                "account.journal", "search_read",
                [[["name", "ilike", "fintoc"]]],
                {"fields": ["id", "name"]},
            )
            journal_id = journals[0]["id"] if journals else 1

        wizard_id = self._call(
            "account.payment.register", "create",
            [{"amount": amount, "memo": memo, "journal_id": journal_id}],
            {"context": {"active_model": "account.move", "active_ids": [invoice_id]}},
        )

        self._call(
            "account.payment.register", "action_create_payments",
            [[wizard_id]],
            {"context": {"active_model": "account.move", "active_ids": [invoice_id]}},
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

    # ── Log de eventos Fintoc ──────────────────────────────────

    def log_fintoc_event(self, event_id: str, event_type: str, data: dict):
        """Guarda el evento Fintoc como nota interna en Odoo."""
        print(f"[FINTOC LOG] {event_id} | {event_type} | {data}")
