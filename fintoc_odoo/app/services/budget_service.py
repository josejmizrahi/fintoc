"""
Servicio de Gestión de Presupuestos.

Funcionalidades:
- CRUD de presupuestos por categoría y período
- Tracking de gastos vs presupuesto
- Alertas por exceso de presupuesto
- Integración con cuentas analíticas de Odoo
- Reportes de ejecución presupuestal
"""

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from app.database import Budget, Notification, NotificationType, Payment, PaymentStatus, get_session_factory

logger = logging.getLogger(__name__)


class BudgetService:
    """Servicio de gestión de presupuestos."""

    def __init__(self, odoo_service=None):
        self.odoo = odoo_service

    def create_budget(
        self,
        name: str,
        amount_budgeted: float,
        period_start: datetime,
        period_end: datetime,
        category: str | None = None,
        alert_threshold_pct: float = 80.0,
        company_id: int | None = None,
        odoo_analytic_account_id: int | None = None,
    ) -> dict:
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            budget = Budget(
                company_id=company_id,
                name=name,
                category=category,
                period_start=period_start,
                period_end=period_end,
                amount_budgeted=amount_budgeted,
                alert_threshold_pct=alert_threshold_pct,
                odoo_analytic_account_id=odoo_analytic_account_id,
            )
            db.add(budget)
            db.commit()
            db.refresh(budget)
            return {"id": budget.id, "name": budget.name, "status": "created"}
        finally:
            db.close()

    def update_budget(self, budget_id: int, **kwargs) -> dict:
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            budget = db.query(Budget).filter_by(id=budget_id).first()
            if not budget:
                return {"ok": False, "error": "Presupuesto no encontrado"}
            for key, value in kwargs.items():
                if hasattr(budget, key) and value is not None:
                    setattr(budget, key, value)
            db.commit()
            return {"ok": True, "id": budget_id}
        finally:
            db.close()

    def delete_budget(self, budget_id: int) -> dict:
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            budget = db.query(Budget).filter_by(id=budget_id).first()
            if not budget:
                return {"ok": False, "error": "Presupuesto no encontrado"}
            budget.is_active = False
            db.commit()
            return {"ok": True}
        finally:
            db.close()

    def record_spend(self, budget_id: int, amount: float) -> dict:
        """Registra un gasto contra un presupuesto."""
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            budget = db.query(Budget).filter_by(id=budget_id).first()
            if not budget:
                return {"ok": False, "error": "Presupuesto no encontrado"}
            budget.amount_spent += amount

            utilization = (budget.amount_spent / budget.amount_budgeted * 100) if budget.amount_budgeted > 0 else 0
            alert_triggered = utilization >= budget.alert_threshold_pct

            if alert_triggered:
                notification = Notification(
                    company_id=budget.company_id,
                    notification_type=NotificationType.BUDGET_EXCEEDED.value,
                    title=f"Presupuesto '{budget.name}' al {utilization:.0f}%",
                    message=f"El presupuesto '{budget.name}' ha alcanzado {utilization:.1f}% de utilización. "
                            f"Gastado: ${budget.amount_spent:,.2f} / ${budget.amount_budgeted:,.2f}",
                    channel="internal",
                )
                db.add(notification)

            db.commit()
            return {
                "ok": True,
                "budget_id": budget_id,
                "amount_spent": budget.amount_spent,
                "utilization_pct": utilization,
                "alert_triggered": alert_triggered,
            }
        finally:
            db.close()

    def commit_spend(self, budget_id: int, amount: float) -> dict:
        """Registra un gasto comprometido (aún no ejecutado)."""
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            budget = db.query(Budget).filter_by(id=budget_id).first()
            if not budget:
                return {"ok": False, "error": "Presupuesto no encontrado"}
            budget.amount_committed += amount
            db.commit()
            return {"ok": True, "amount_committed": budget.amount_committed}
        finally:
            db.close()

    def get_budget(self, budget_id: int) -> dict | None:
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            b = db.query(Budget).filter_by(id=budget_id).first()
            if not b:
                return None
            return self._budget_to_dict(b)
        finally:
            db.close()

    def list_budgets(
        self, company_id: int | None = None, active_only: bool = True
    ) -> list[dict]:
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            query = db.query(Budget)
            if company_id:
                query = query.filter_by(company_id=company_id)
            if active_only:
                query = query.filter_by(is_active=True)
            budgets = query.order_by(Budget.period_start.desc()).all()
            return [self._budget_to_dict(b) for b in budgets]
        finally:
            db.close()

    def get_budget_vs_actual(self, company_id: int | None = None) -> list[dict]:
        """Reporte de presupuesto vs ejecución real."""
        return self.list_budgets(company_id=company_id, active_only=True)

    def _budget_to_dict(self, b: Budget) -> dict:
        available = b.amount_budgeted - b.amount_spent - b.amount_committed
        utilization = (b.amount_spent / b.amount_budgeted * 100) if b.amount_budgeted > 0 else 0
        return {
            "id": b.id,
            "name": b.name,
            "category": b.category,
            "period_start": str(b.period_start) if b.period_start else None,
            "period_end": str(b.period_end) if b.period_end else None,
            "amount_budgeted": b.amount_budgeted,
            "amount_spent": b.amount_spent,
            "amount_committed": b.amount_committed,
            "available": available,
            "utilization_pct": round(utilization, 1),
            "alert_threshold_pct": b.alert_threshold_pct,
            "is_over_budget": b.amount_spent > b.amount_budgeted,
            "is_active": b.is_active,
        }
