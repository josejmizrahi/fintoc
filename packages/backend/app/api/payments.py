"""
API de Pagos (Accounts Payable).
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from app.models.schemas import (
    BatchPaymentRequest,
    BatchPaymentResponse,
    PaymentCreate,
    PaymentResponse,
    VendorPaymentRequest,
    VendorPaymentResponse,
)

router = APIRouter(prefix="/payments", tags=["Pagos"])


def _get_payment_service():
    from app.services.fintoc_service import get_fintoc_service
    from app.services.odoo_service import get_odoo_service
    from app.services.sat_service import get_sat_service
    from app.services.payment_service import PaymentService
    return PaymentService(get_fintoc_service(), get_odoo_service(), get_sat_service())


@router.get("/")
def list_payments(
    direction: Optional[str] = None,
    status: Optional[str] = None,
    company_id: Optional[int] = None,
    limit: int = Query(default=100, le=500),
):
    """Lista pagos con filtros opcionales."""
    svc = _get_payment_service()
    return svc.list_payments(direction=direction, status=status, company_id=company_id, limit=limit)


@router.get("/{payment_id}")
def get_payment(payment_id: int):
    """Detalle de un pago."""
    svc = _get_payment_service()
    result = svc.get_payment(payment_id)
    if not result:
        raise HTTPException(status_code=404, detail="Pago no encontrado")
    return result


@router.post("/vendor")
def pay_vendor(req: VendorPaymentRequest):
    """Pago individual a proveedor con validación SAT."""
    svc = _get_payment_service()
    result = svc.pay_vendor_bill(
        bill_id=req.bill_id,
        skip_sat=req.skip_sat,
        company_id=req.company_id,
    )
    return result


@router.post("/batch")
def batch_pay(req: BatchPaymentRequest):
    """Pagos masivos con validación SAT opcional."""
    svc = _get_payment_service()
    items = [item.model_dump() for item in req.payments]
    result = svc.batch_pay(
        payments_data=items,
        validate_sat=req.validate_sat,
        company_id=req.company_id,
    )
    return result


@router.post("/{payment_id}/execute")
def execute_payment(payment_id: int):
    """Ejecuta un pago aprobado."""
    svc = _get_payment_service()
    return svc.execute_approved_payment(payment_id)


@router.post("/{payment_id}/schedule")
def schedule_payment(payment_id: int, scheduled_date: str, recurrence: Optional[str] = None):
    """Programa un pago para fecha futura."""
    from datetime import datetime
    svc = _get_payment_service()
    dt = datetime.fromisoformat(scheduled_date)
    return svc.schedule_payment(payment_id, dt, recurrence=recurrence)


@router.get("/scheduled/list")
def list_scheduled():
    """Lista pagos programados."""
    svc = _get_payment_service()
    return svc.get_scheduled_payments()
