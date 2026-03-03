"""
API de Gastos (Expense Management).
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from app.models.schemas import ExpenseCreate, ExpenseAction

router = APIRouter(prefix="/expenses", tags=["Gastos"])


def _get_service():
    from app.services.sat_service import get_sat_service
    from app.services.odoo_service import get_odoo_service
    from app.services.fintoc_service import get_fintoc_service
    from app.services.expense_service import ExpenseService
    return ExpenseService(get_sat_service(), get_odoo_service(), get_fintoc_service())


@router.get("/")
def list_expenses(
    status: Optional[str] = None,
    company_id: Optional[int] = None,
    employee: Optional[str] = None,
    limit: int = Query(default=100, le=500),
):
    """Lista gastos con filtros."""
    return _get_service().list_expenses(status=status, company_id=company_id, employee_name=employee, limit=limit)


@router.get("/summary")
def expense_summary(company_id: Optional[int] = None):
    """Resumen de gastos por categoría y estado."""
    return _get_service().get_expense_summary(company_id=company_id)


@router.post("/")
def create_expense(req: ExpenseCreate):
    """Crea un nuevo gasto."""
    return _get_service().create_expense(
        employee_name=req.employee_name,
        amount=req.amount,
        category=req.category,
        description=req.description,
        cfdi_xml=req.cfdi_xml,
        cfdi_uuid=req.cfdi_uuid,
        employee_email=req.employee_email,
        receipt_url=req.receipt_url,
        company_id=req.company_id,
    )


@router.post("/{expense_id}/action")
def expense_action(expense_id: int, action: ExpenseAction):
    """Ejecuta una acción sobre un gasto: submit, approve, reject, pay."""
    svc = _get_service()
    if action.action == "submit":
        return svc.submit_expense(expense_id)
    elif action.action == "approve":
        return svc.approve_expense(expense_id, approver=action.approver_email)
    elif action.action == "reject":
        return svc.reject_expense(expense_id, reason=action.comment)
    elif action.action == "pay":
        return svc.pay_expense(expense_id)
    return {"ok": False, "error": "Acción inválida"}
