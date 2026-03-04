"""
API de Cobranza (Accounts Receivable).
"""

from fastapi import APIRouter, Query
from typing import Optional

router = APIRouter(prefix="/collections", tags=["Cobranza"])


def _get_service():
    from app.services.fintoc_service import get_fintoc_service
    from app.services.odoo_service import get_odoo_service
    from app.services.collection_service import CollectionService
    return CollectionService(get_fintoc_service(), get_odoo_service())


@router.get("/pending")
def list_pending(partner_id: Optional[int] = None):
    """Lista facturas pendientes de cobro."""
    return _get_service().get_pending_collections(partner_id=partner_id)


@router.get("/overdue")
def list_overdue(days: int = Query(default=0)):
    """Lista facturas vencidas."""
    return _get_service().get_overdue_collections(days_overdue=days)


@router.get("/customer/{partner_id}")
def customer_summary(partner_id: int):
    """Resumen de cobranza por cliente."""
    return _get_service().get_collection_summary(partner_id)


@router.post("/customer/{partner_id}/clabe")
def setup_clabe(partner_id: int):
    """Crea o retorna la CLABE virtual de un cliente."""
    return _get_service().setup_customer_clabe(partner_id)


@router.post("/clabes/setup-all")
def setup_all_clabes():
    """Crea CLABEs para todos los clientes sin una."""
    return _get_service().setup_all_customer_clabes()


@router.post("/clabes/sync")
def sync_clabes():
    """Sincroniza CLABEs con Odoo."""
    return _get_service().sync_customer_clabes()


@router.post("/payment-link")
def generate_payment_link(
    partner_id: int,
    amount: Optional[float] = None,
    invoice_id: Optional[int] = None,
):
    """Genera un link de pago Fintoc para cobrar a un cliente."""
    return _get_service().generate_payment_link(partner_id, amount, invoice_id)


@router.get("/aging")
def aging_receivable():
    """Reporte de antigüedad de saldos por cobrar."""
    return _get_service().get_aging_receivable()
