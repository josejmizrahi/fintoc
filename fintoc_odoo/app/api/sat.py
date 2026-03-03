"""
API de SAT / CFDI.
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from app.models.schemas import CfdiValidationRequest, CfdiUploadRequest, CfdiBulkValidationRequest

router = APIRouter(prefix="/sat", tags=["SAT / CFDI"])


def _get_service():
    from app.services.sat_service import get_sat_service
    return get_sat_service()


@router.post("/validate")
def validate_cfdi(req: CfdiValidationRequest):
    """Valida un CFDI contra el SAT."""
    svc = _get_service()
    result = svc.validar_cfdi(
        rfc_emisor=req.rfc_emisor,
        rfc_receptor=req.rfc_receptor,
        total=req.total,
        uuid=req.uuid,
        sello_ultimos_8=req.sello_ultimos_8,
    )
    result["is_valid"] = result.get("Estado") == "Vigente"
    result["has_efos_issue"] = svc.tiene_problema_efos(result)
    return result


@router.post("/validate/bulk")
def validate_bulk(req: CfdiBulkValidationRequest):
    """Validación masiva de CFDIs contra el SAT."""
    svc = _get_service()
    if req.uuids:
        # Obtener datos de la DB local
        stored = svc.get_stored_cfdis(company_id=req.company_id)
        cfdis = [
            {
                "rfc_emisor": d["rfc_emisor"],
                "rfc_receptor": d["rfc_receptor"],
                "total": d["total"],
                "uuid": d["uuid"],
            }
            for d in stored if d["uuid"] in req.uuids
        ]
    else:
        # Revalidar todos
        stats = svc.revalidate_all(company_id=req.company_id)
        return stats
    results = svc.validar_cfdis_bulk(cfdis)
    return {
        "total": len(results),
        "valid": sum(1 for r in results if r.get("is_valid")),
        "invalid": sum(1 for r in results if not r.get("is_valid") and not r.get("error")),
        "errors": sum(1 for r in results if r.get("error")),
        "results": results,
    }


@router.post("/upload-xml")
def upload_cfdi_xml(req: CfdiUploadRequest):
    """Sube y procesa un XML CFDI. Lo valida contra SAT automáticamente."""
    return _get_service().parse_and_store_cfdi(req.xml_content, company_id=req.company_id)


@router.get("/documents")
def list_cfdis(company_id: Optional[int] = None, limit: int = Query(default=100, le=500)):
    """Lista CFDIs almacenados."""
    return _get_service().get_stored_cfdis(company_id=company_id, limit=limit)


@router.post("/revalidate-all")
def revalidate_all(company_id: Optional[int] = None):
    """Revalida todos los CFDIs almacenados contra el SAT."""
    return _get_service().revalidate_all(company_id=company_id)
