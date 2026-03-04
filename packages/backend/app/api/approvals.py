"""
API de Flujos de Aprobación.
"""

from fastapi import APIRouter, Query
from typing import Optional

from app.models.schemas import ApprovalRuleCreate, ApprovalAction

router = APIRouter(prefix="/approvals", tags=["Aprobaciones"])


def _get_service():
    from app.services.approval_service import ApprovalService
    return ApprovalService()


@router.get("/rules")
def list_rules(company_id: Optional[int] = None):
    """Lista reglas de aprobación activas."""
    return _get_service().list_rules(company_id=company_id)


@router.post("/rules")
def create_rule(req: ApprovalRuleCreate):
    """Crea una nueva regla de aprobación."""
    return _get_service().create_rule(
        name=req.name,
        min_amount=req.min_amount,
        max_amount=req.max_amount,
        required_approvers=req.required_approvers,
        approver_emails=req.approver_emails,
        auto_approve_below=req.auto_approve_below,
        company_id=req.company_id,
    )


@router.put("/rules/{rule_id}")
def update_rule(rule_id: int, req: ApprovalRuleCreate):
    """Actualiza una regla."""
    return _get_service().update_rule(rule_id, **req.model_dump(exclude_none=True))


@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: int):
    """Desactiva una regla."""
    return _get_service().delete_rule(rule_id)


@router.get("/pending")
def list_pending(approver_email: Optional[str] = None):
    """Lista aprobaciones pendientes."""
    return _get_service().get_pending_approvals(approver_email=approver_email)


@router.post("/{payment_id}/approve")
def approve_payment(payment_id: int, action: ApprovalAction):
    """Aprueba un pago."""
    return _get_service().approve_payment(
        payment_id=payment_id,
        approver_email=action.approver_email,
        comment=action.comment,
    )


@router.post("/{payment_id}/reject")
def reject_payment(payment_id: int, action: ApprovalAction):
    """Rechaza un pago."""
    return _get_service().reject_payment(
        payment_id=payment_id,
        approver_email=action.approver_email,
        comment=action.comment,
    )


@router.get("/{payment_id}/history")
def approval_history(payment_id: int):
    """Historial de aprobaciones de un pago."""
    return _get_service().get_approval_history(payment_id)
