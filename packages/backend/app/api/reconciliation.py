"""
API de Conciliación Bancaria y SAT.
"""

from fastapi import APIRouter, Query
from typing import Optional

router = APIRouter(prefix="/reconciliation", tags=["Conciliación"])


def _get_service():
    from app.services.fintoc_service import get_fintoc_service
    from app.services.odoo_service import get_odoo_service
    from app.services.sat_service import get_sat_service
    from app.services.reconciliation_service import ReconciliationService
    return ReconciliationService(get_fintoc_service(), get_odoo_service(), get_sat_service())


@router.post("/fintoc-odoo")
def reconcile_fintoc_odoo(
    days: int = Query(default=7, le=90),
    auto_match: bool = True,
    company_id: Optional[int] = None,
):
    """Conciliación Fintoc vs Odoo."""
    return _get_service().reconcile_fintoc_odoo(days=days, auto_match=auto_match, company_id=company_id)


@router.post("/sat")
def reconcile_sat(days: int = Query(default=7, le=90), company_id: Optional[int] = None):
    """Conciliación SAT: complementos de pago timbrados vs vigentes."""
    return _get_service().reconcile_sat(days=days, company_id=company_id)


@router.get("/history")
def reconciliation_history(company_id: Optional[int] = None, limit: int = Query(default=100, le=500)):
    """Historial de conciliaciones."""
    return _get_service().get_reconciliation_history(company_id=company_id, limit=limit)
