"""
API de Proveedores.
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional

router = APIRouter(prefix="/vendors", tags=["Proveedores"])


def _get_odoo():
    from app.services.odoo_service import get_odoo_service
    return get_odoo_service()


def _get_fintoc():
    from app.services.fintoc_service import get_fintoc_service
    return get_fintoc_service()


@router.get("/")
def list_vendors(limit: int = Query(default=100, le=500)):
    """Lista todos los proveedores activos."""
    return _get_odoo().get_all_vendors(limit=limit)


@router.get("/{partner_id}")
def get_vendor(partner_id: int):
    """Detalle de un proveedor."""
    result = _get_odoo().get_vendor(partner_id)
    if not result:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")
    return result


@router.get("/{partner_id}/clabe")
def get_vendor_clabe(partner_id: int):
    """CLABE bancaria del proveedor."""
    clabe = _get_odoo().get_vendor_clabe(partner_id)
    if not clabe:
        raise HTTPException(status_code=404, detail="Sin CLABE registrada")
    return {"partner_id": partner_id, "clabe": clabe}


@router.post("/{partner_id}/clabe")
def set_vendor_clabe(partner_id: int, clabe: str, bank_name: str = ""):
    """Registra una CLABE para un proveedor."""
    from app.utils.validators import validate_clabe
    valid, msg = validate_clabe(clabe)
    if not valid:
        raise HTTPException(status_code=400, detail=msg)
    bank_id = _get_odoo().set_vendor_clabe(partner_id, clabe, bank_name)
    return {"partner_id": partner_id, "clabe": clabe, "bank_id": bank_id}


@router.post("/{partner_id}/verify-clabe")
def verify_vendor_clabe(partner_id: int):
    """Verifica la CLABE de un proveedor vía Fintoc ($0.01 MXN)."""
    clabe = _get_odoo().get_vendor_clabe(partner_id)
    if not clabe:
        raise HTTPException(status_code=404, detail="Sin CLABE registrada")
    return _get_fintoc().verify_clabe(clabe)


@router.get("/{partner_id}/bills")
def vendor_bills(partner_id: int):
    """Facturas pendientes del proveedor."""
    return _get_odoo().get_pending_bills(partner_id=partner_id)
