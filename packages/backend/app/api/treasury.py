"""
API de Tesorería y Cash Management.
"""

from fastapi import APIRouter, Query
from typing import Optional

router = APIRouter(prefix="/treasury", tags=["Tesorería"])


def _get_service():
    from app.services.fintoc_service import get_fintoc_service
    from app.services.odoo_service import get_odoo_service
    from app.services.treasury_service import TreasuryService
    return TreasuryService(get_fintoc_service(), get_odoo_service())


@router.get("/snapshot")
def treasury_snapshot(company_id: Optional[int] = None):
    """Snapshot de tesorería en tiempo real."""
    return _get_service().get_treasury_snapshot(company_id=company_id)


@router.get("/forecast")
def cash_flow_forecast(days: int = Query(default=30, le=365), company_id: Optional[int] = None):
    """Proyección de flujo de efectivo."""
    return _get_service().get_cash_flow_forecast(days=days, company_id=company_id)


@router.get("/cash-flow")
def cash_flow_summary(days: int = Query(default=30, le=365), company_id: Optional[int] = None):
    """Resumen de flujo de efectivo del período."""
    return _get_service().get_cash_flow_summary(period_days=days, company_id=company_id)


@router.get("/balance")
def account_balance():
    """Balance de la cuenta Fintoc."""
    from app.services.fintoc_service import get_fintoc_service
    return get_fintoc_service().get_account_balance()


@router.get("/movements")
def recent_movements(days: int = Query(default=30), limit: int = Query(default=100, le=500)):
    """Movimientos bancarios recientes."""
    from app.services.fintoc_service import get_fintoc_service
    return get_fintoc_service().get_movements(days=days, limit=limit)
