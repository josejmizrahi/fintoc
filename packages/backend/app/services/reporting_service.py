"""
Servicio de Reportes y Analítica.

Funcionalidades:
- Reporte de flujo de efectivo
- Reporte de antigüedad de saldos (aging)
- Reporte de cumplimiento SAT
- Reporte de presupuesto vs ejecución
- Reporte de resumen de proveedores
- Exportación CSV
"""

import csv
import io
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.database import (
    Budget,
    CfdiDocument,
    Expense,
    Payment,
    PaymentStatus,
    Reconciliation,
    get_session_factory,
)

logger = logging.getLogger(__name__)


class ReportingService:
    """Servicio de reportes y analítica financiera."""

    def __init__(self, odoo_service, fintoc_service=None, sat_service=None):
        self.odoo = odoo_service
        self.fintoc = fintoc_service
        self.sat = sat_service

    def cash_flow_report(
        self, date_from: str | None = None, date_to: str | None = None,
        company_id: int | None = None,
    ) -> dict:
        """Reporte de flujo de efectivo por período."""
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            now = datetime.now(timezone.utc)
            if not date_from:
                date_from_dt = now - timedelta(days=30)
            else:
                date_from_dt = datetime.strptime(date_from, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            if not date_to:
                date_to_dt = now
            else:
                date_to_dt = datetime.strptime(date_to, "%Y-%m-%d").replace(tzinfo=timezone.utc)

            query = db.query(Payment).filter(
                Payment.executed_at >= date_from_dt,
                Payment.executed_at <= date_to_dt,
                Payment.status.in_([PaymentStatus.SENT.value, PaymentStatus.CONFIRMED.value]),
            )
            if company_id:
                query = query.filter_by(company_id=company_id)
            payments = query.order_by(Payment.executed_at).all()

            inflows = [
                {
                    "date": str(p.executed_at),
                    "amount": p.amount,
                    "reference": p.reference_id,
                    "partner": p.partner_name,
                }
                for p in payments if p.direction == "inbound"
            ]
            outflows = [
                {
                    "date": str(p.executed_at),
                    "amount": p.amount,
                    "reference": p.reference_id,
                    "partner": p.partner_name,
                }
                for p in payments if p.direction == "outbound"
            ]

            total_in = sum(p.amount for p in payments if p.direction == "inbound")
            total_out = sum(p.amount for p in payments if p.direction == "outbound")

            return {
                "period": f"{date_from_dt.strftime('%Y-%m-%d')} a {date_to_dt.strftime('%Y-%m-%d')}",
                "inflows": inflows,
                "outflows": outflows,
                "total_inflows": total_in,
                "total_outflows": total_out,
                "net_flow": total_in - total_out,
            }
        finally:
            db.close()

    def aging_report(self, report_type: str = "receivable") -> dict:
        """Reporte de antigüedad de saldos."""
        if report_type == "receivable":
            return self.odoo.get_aging_receivable()
        elif report_type == "payable":
            return self.odoo.get_aging_payable()
        return {"error": "Tipo de reporte inválido (use 'receivable' o 'payable')"}

    def sat_compliance_report(
        self, days: int = 30, company_id: int | None = None
    ) -> dict:
        """Reporte de cumplimiento SAT: estado de CFDIs."""
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            cutoff = datetime.now(timezone.utc) - timedelta(days=days)
            query = db.query(CfdiDocument).filter(CfdiDocument.created_at >= cutoff)
            if company_id:
                query = query.filter_by(company_id=company_id)
            docs = query.all()

            valid = sum(1 for d in docs if d.sat_status == "Vigente")
            invalid = sum(1 for d in docs if d.sat_status and d.sat_status not in ("Vigente", "Error", ""))
            cancelled = sum(1 for d in docs if d.sat_status in ("Cancelado",))
            efos = sum(1 for d in docs if d.efos_status and "PLR" in (d.efos_status or "").upper())

            # Pagos sin complemento
            payments = self.odoo.get_payments_fintoc(days=days)
            missing_complement = sum(
                1 for p in payments if not (p.get("l10n_mx_edi_cfdi_uuid") or "").strip()
            )

            details = [
                {
                    "uuid": d.uuid,
                    "tipo": d.tipo_comprobante,
                    "emisor": d.rfc_emisor,
                    "receptor": d.rfc_receptor,
                    "total": d.total,
                    "sat_status": d.sat_status,
                    "efos": d.efos_status,
                    "fecha": str(d.fecha_emision) if d.fecha_emision else None,
                }
                for d in docs
            ]

            return {
                "period_days": days,
                "total_cfdis": len(docs),
                "valid": valid,
                "invalid": invalid,
                "cancelled": cancelled,
                "efos_issues": efos,
                "missing_complement": missing_complement,
                "details": details,
            }
        finally:
            db.close()

    def budget_vs_actual_report(self, company_id: int | None = None) -> list[dict]:
        """Reporte presupuesto vs ejecución."""
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            query = db.query(Budget).filter_by(is_active=True)
            if company_id:
                query = query.filter_by(company_id=company_id)
            budgets = query.all()
            return [
                {
                    "name": b.name,
                    "category": b.category,
                    "period": f"{b.period_start} - {b.period_end}",
                    "budgeted": b.amount_budgeted,
                    "spent": b.amount_spent,
                    "committed": b.amount_committed,
                    "available": b.amount_budgeted - b.amount_spent - b.amount_committed,
                    "utilization_pct": round(
                        (b.amount_spent / b.amount_budgeted * 100) if b.amount_budgeted > 0 else 0, 1
                    ),
                    "is_over": b.amount_spent > b.amount_budgeted,
                }
                for b in budgets
            ]
        finally:
            db.close()

    def vendor_summary_report(self, company_id: int | None = None) -> list[dict]:
        """Resumen de pagos por proveedor."""
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            query = db.query(Payment).filter_by(direction="outbound")
            if company_id:
                query = query.filter_by(company_id=company_id)
            payments = query.filter(
                Payment.status.in_([PaymentStatus.SENT.value, PaymentStatus.CONFIRMED.value])
            ).all()

            by_partner: dict[str, dict] = {}
            for p in payments:
                key = p.partner_name or f"Partner-{p.odoo_partner_id}"
                if key not in by_partner:
                    by_partner[key] = {"name": key, "total_paid": 0, "num_payments": 0, "last_payment": None}
                by_partner[key]["total_paid"] += p.amount
                by_partner[key]["num_payments"] += 1
                if p.executed_at:
                    current = by_partner[key]["last_payment"]
                    if current is None or p.executed_at > datetime.fromisoformat(current):
                        by_partner[key]["last_payment"] = str(p.executed_at)

            return sorted(by_partner.values(), key=lambda x: x["total_paid"], reverse=True)
        finally:
            db.close()

    def expense_report(
        self, company_id: int | None = None, date_from: str | None = None, date_to: str | None = None,
    ) -> dict:
        """Reporte de gastos."""
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            query = db.query(Expense)
            if company_id:
                query = query.filter_by(company_id=company_id)
            if date_from:
                query = query.filter(Expense.created_at >= date_from)
            if date_to:
                query = query.filter(Expense.created_at <= date_to)
            expenses = query.all()

            by_category: dict[str, float] = {}
            by_employee: dict[str, float] = {}
            by_status: dict[str, int] = {}
            for e in expenses:
                cat = e.category or "Sin categoría"
                by_category[cat] = by_category.get(cat, 0) + e.amount
                by_employee[e.employee_name] = by_employee.get(e.employee_name, 0) + e.amount
                by_status[e.status] = by_status.get(e.status, 0) + 1

            return {
                "total_expenses": len(expenses),
                "total_amount": sum(e.amount for e in expenses),
                "by_category": by_category,
                "by_employee": by_employee,
                "by_status": by_status,
            }
        finally:
            db.close()

    def export_to_csv(self, data: list[dict]) -> str:
        """Convierte una lista de dicts a formato CSV."""
        if not data:
            return ""
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=data[0].keys())
        writer.writeheader()
        writer.writerows(data)
        return output.getvalue()
