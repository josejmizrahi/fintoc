"""
API de Presupuestos.
"""

from fastapi import APIRouter, HTTPException
from typing import Optional

from app.models.schemas import BudgetCreate

router = APIRouter(prefix="/budgets", tags=["Presupuestos"])


def _get_service():
    from app.services.budget_service import BudgetService
    return BudgetService()


@router.get("/")
def list_budgets(company_id: Optional[int] = None, active_only: bool = True):
    """Lista presupuestos."""
    return _get_service().list_budgets(company_id=company_id, active_only=active_only)


@router.get("/vs-actual")
def budget_vs_actual(company_id: Optional[int] = None):
    """Reporte de presupuesto vs ejecución."""
    return _get_service().get_budget_vs_actual(company_id=company_id)


@router.get("/{budget_id}")
def get_budget(budget_id: int):
    """Detalle de un presupuesto."""
    result = _get_service().get_budget(budget_id)
    if not result:
        raise HTTPException(status_code=404, detail="Presupuesto no encontrado")
    return result


@router.post("/")
def create_budget(req: BudgetCreate):
    """Crea un nuevo presupuesto."""
    return _get_service().create_budget(
        name=req.name,
        amount_budgeted=req.amount_budgeted,
        period_start=req.period_start,
        period_end=req.period_end,
        category=req.category,
        alert_threshold_pct=req.alert_threshold_pct,
        company_id=req.company_id,
        odoo_analytic_account_id=req.odoo_analytic_account_id,
    )


@router.put("/{budget_id}")
def update_budget(budget_id: int, req: BudgetCreate):
    """Actualiza un presupuesto."""
    return _get_service().update_budget(budget_id, **req.model_dump(exclude_none=True))


@router.delete("/{budget_id}")
def delete_budget(budget_id: int):
    """Desactiva un presupuesto."""
    return _get_service().delete_budget(budget_id)


@router.post("/{budget_id}/spend")
def record_spend(budget_id: int, amount: float):
    """Registra gasto contra presupuesto."""
    return _get_service().record_spend(budget_id, amount)


@router.post("/{budget_id}/commit")
def commit_spend(budget_id: int, amount: float):
    """Registra gasto comprometido."""
    return _get_service().commit_spend(budget_id, amount)
