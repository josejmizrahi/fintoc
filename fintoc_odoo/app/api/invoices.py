"""
API de Facturas (Invoices & Bills).
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional

router = APIRouter(prefix="/invoices", tags=["Facturas"])


def _get_odoo():
    from app.services.odoo_service import get_odoo_service
    return get_odoo_service()


@router.get("/receivable")
def list_receivable(partner_id: Optional[int] = None, limit: int = Query(default=200, le=500)):
    """Lista facturas de venta pendientes de cobro."""
    return _get_odoo().get_pending_invoices(partner_id=partner_id, limit=limit)


@router.get("/payable")
def list_payable(partner_id: Optional[int] = None, limit: int = Query(default=200, le=500)):
    """Lista facturas de compra pendientes de pago."""
    return _get_odoo().get_pending_bills(partner_id=partner_id, limit=limit)


@router.get("/overdue/receivable")
def overdue_receivable(days: int = Query(default=0)):
    """Facturas de venta vencidas."""
    return _get_odoo().get_overdue_invoices(days_overdue=days)


@router.get("/overdue/payable")
def overdue_payable(days: int = Query(default=0)):
    """Facturas de compra vencidas."""
    return _get_odoo().get_overdue_bills(days_overdue=days)


@router.get("/{invoice_id}")
def get_invoice(invoice_id: int):
    """Detalle de una factura."""
    result = _get_odoo().get_invoice(invoice_id)
    if not result:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    return result


@router.get("/{invoice_id}/cfdi")
def get_invoice_cfdi(invoice_id: int):
    """Datos CFDI de una factura."""
    result = _get_odoo().get_invoice_cfdi_data(invoice_id)
    if not result:
        raise HTTPException(status_code=404, detail="Sin datos CFDI")
    return result


@router.get("/aging/receivable")
def aging_receivable():
    """Antigüedad de saldos por cobrar."""
    return _get_odoo().get_aging_receivable()


@router.get("/aging/payable")
def aging_payable():
    """Antigüedad de saldos por pagar."""
    return _get_odoo().get_aging_payable()
