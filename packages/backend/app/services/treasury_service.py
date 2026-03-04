"""
Servicio de Tesorería y Gestión de Flujo de Efectivo.

Funcionalidades:
- Dashboard de tesorería en tiempo real
- Balance consolidado multi-cuenta
- Flujo de efectivo (inflows/outflows)
- Proyección de flujo de efectivo (forecast)
- Posición de tesorería por empresa
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.database import Payment, PaymentStatus, get_session_factory

logger = logging.getLogger(__name__)


class TreasuryService:
    """Servicio de tesorería y cash management."""

    def __init__(self, fintoc_service, odoo_service):
        self.fintoc = fintoc_service
        self.odoo = odoo_service

    def get_treasury_snapshot(self, company_id: int | None = None) -> dict:
        """Snapshot completo de tesorería en tiempo real."""
        # Balance Fintoc
        balance_data = self.fintoc.get_account_balance()

        # Facturas pendientes de cobro y pago
        pending_invoices = self.odoo.get_pending_invoices()
        pending_bills = self.odoo.get_pending_bills()
        total_receivable = sum(inv.get("amount_residual", 0) for inv in pending_invoices)
        total_payable = sum(bill.get("amount_residual", 0) for bill in pending_bills)

        # Pagos locales del día/semana/mes
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            now = datetime.now(timezone.utc)
            today = now.replace(hour=0, minute=0, second=0, microsecond=0)
            week_ago = now - timedelta(days=7)
            month_ago = now - timedelta(days=30)

            query = db.query(Payment)
            if company_id:
                query = query.filter_by(company_id=company_id)
            all_payments = query.filter(Payment.status.in_([
                PaymentStatus.SENT.value, PaymentStatus.CONFIRMED.value
            ])).all()

            inflows_today = sum(p.amount for p in all_payments if p.direction == "inbound" and p.executed_at and p.executed_at >= today)
            outflows_today = sum(p.amount for p in all_payments if p.direction == "outbound" and p.executed_at and p.executed_at >= today)
            inflows_week = sum(p.amount for p in all_payments if p.direction == "inbound" and p.executed_at and p.executed_at >= week_ago)
            outflows_week = sum(p.amount for p in all_payments if p.direction == "outbound" and p.executed_at and p.executed_at >= week_ago)
            inflows_month = sum(p.amount for p in all_payments if p.direction == "inbound" and p.executed_at and p.executed_at >= month_ago)
            outflows_month = sum(p.amount for p in all_payments if p.direction == "outbound" and p.executed_at and p.executed_at >= month_ago)

            pending_inbound = sum(
                p.amount for p in all_payments
                if p.direction == "inbound" and p.status == PaymentStatus.PROCESSING.value
            )
            pending_outbound = sum(
                p.amount for p in all_payments
                if p.direction == "outbound" and p.status in [
                    PaymentStatus.PENDING_APPROVAL.value, PaymentStatus.APPROVED.value,
                    PaymentStatus.SCHEDULED.value, PaymentStatus.PROCESSING.value,
                ]
            )

            return {
                "date": now.isoformat(),
                "total_balance": balance_data.get("balance", 0),
                "accounts": [balance_data],
                "accounts_receivable": total_receivable,
                "accounts_payable": total_payable,
                "inflows_today": inflows_today,
                "outflows_today": outflows_today,
                "inflows_week": inflows_week,
                "outflows_week": outflows_week,
                "inflows_month": inflows_month,
                "outflows_month": outflows_month,
                "pending_inbound": pending_inbound,
                "pending_outbound": pending_outbound,
                "net_position": balance_data.get("balance", 0) + total_receivable - total_payable,
            }
        finally:
            db.close()

    def get_cash_flow_forecast(
        self, days: int = 30, company_id: int | None = None
    ) -> list[dict]:
        """
        Proyección de flujo de efectivo basada en:
        - Facturas por cobrar con fecha de vencimiento
        - Facturas por pagar con fecha de vencimiento
        - Pagos programados
        """
        balance = self.fintoc.get_account_balance().get("balance", 0)
        pending_invoices = self.odoo.get_pending_invoices()
        pending_bills = self.odoo.get_pending_bills()

        today = datetime.now().date()
        forecast = []
        running_balance = balance

        for i in range(days):
            date = today + timedelta(days=i)
            date_str = date.strftime("%Y-%m-%d")

            expected_in = sum(
                inv.get("amount_residual", 0)
                for inv in pending_invoices
                if inv.get("invoice_date_due") == date_str
            )
            expected_out = sum(
                bill.get("amount_residual", 0)
                for bill in pending_bills
                if bill.get("invoice_date_due") == date_str
            )

            running_balance = running_balance + expected_in - expected_out

            forecast.append({
                "date": date_str,
                "expected_inflows": expected_in,
                "expected_outflows": expected_out,
                "net_flow": expected_in - expected_out,
                "projected_balance": running_balance,
            })

        return forecast

    def get_cash_flow_summary(self, period_days: int = 30, company_id: int | None = None) -> dict:
        """Resumen de flujo de efectivo del período."""
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            cutoff = datetime.now(timezone.utc) - timedelta(days=period_days)
            query = db.query(Payment).filter(
                Payment.status.in_([PaymentStatus.SENT.value, PaymentStatus.CONFIRMED.value]),
                Payment.executed_at >= cutoff,
            )
            if company_id:
                query = query.filter_by(company_id=company_id)
            payments = query.all()

            inflows = [p for p in payments if p.direction == "inbound"]
            outflows = [p for p in payments if p.direction == "outbound"]

            return {
                "period_days": period_days,
                "total_inflows": sum(p.amount for p in inflows),
                "total_outflows": sum(p.amount for p in outflows),
                "net_flow": sum(p.amount for p in inflows) - sum(p.amount for p in outflows),
                "num_inflows": len(inflows),
                "num_outflows": len(outflows),
                "avg_inflow": sum(p.amount for p in inflows) / len(inflows) if inflows else 0,
                "avg_outflow": sum(p.amount for p in outflows) / len(outflows) if outflows else 0,
            }
        finally:
            db.close()
