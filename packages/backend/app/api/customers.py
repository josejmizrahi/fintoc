"""
API de Clientes.
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional

router = APIRouter(prefix="/customers", tags=["Clientes"])


def _get_odoo():
    from app.services.odoo_service import get_odoo_service
    return get_odoo_service()


def _get_fintoc():
    from app.services.fintoc_service import get_fintoc_service
    return get_fintoc_service()


@router.get("/")
def list_customers(limit: int = Query(default=100, le=500)):
    """Lista todos los clientes activos."""
    return _get_odoo().get_all_customers(limit=limit)


@router.get("/search")
def search_customers(q: str):
    """Busca clientes por nombre, RFC o referencia."""
    return _get_odoo().search_customers(q)


@router.get("/{partner_id}")
def get_customer(partner_id: int):
    """Detalle de un cliente."""
    result = _get_odoo().get_customer(partner_id)
    if not result:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    return result


@router.get("/{partner_id}/clabe")
def get_customer_clabe(partner_id: int):
    """CLABE virtual asignada al cliente."""
    clabe = _get_fintoc().get_clabe_by_partner(partner_id)
    if not clabe:
        raise HTTPException(status_code=404, detail="Sin CLABE virtual")
    return {"partner_id": partner_id, "clabe": clabe}


@router.get("/{partner_id}/invoices")
def customer_invoices(partner_id: int):
    """Facturas pendientes del cliente."""
    return _get_odoo().get_pending_invoices(partner_id=partner_id)
