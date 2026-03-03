"""
Servicio SAT mejorado: validación de CFDIs, detección EFOS, parseo XML,
bulk validation, y almacenamiento en base de datos local.

Soporta:
- Validación individual y masiva de CFDIs contra el SAT
- Parseo completo de XML CFDI 3.3/4.0
- Detección de proveedores en lista EFOS
- Almacenamiento y tracking de CFDIs validados
- Conciliación SAT vs complementos de pago
"""

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from requests import Session
from sqlalchemy.orm import Session as DBSession
from zeep import Client
from zeep.transports import Transport

from app.config import get_settings
from app.database import CfdiDocument, get_session_factory
from app.utils.cfdi_parser import extract_sello_last8, extract_uuid, parse_cfdi_xml

logger = logging.getLogger(__name__)


def _normalize_total(total: str | float) -> str:
    if isinstance(total, (int, float)):
        total = f"{float(total):.2f}"
    total = str(total).strip()
    if "." in total:
        total = total.rstrip("0").rstrip(".")
    return total


class SATService:
    """Servicio completo de integración con el SAT."""

    def __init__(self):
        settings = get_settings()
        session = Session()
        session.verify = True
        transport = Transport(session=session)
        self._client = Client(settings.sat_wsdl_url, transport=transport)

    # ── Validación de CFDIs ──

    def validar_cfdi(
        self,
        rfc_emisor: str,
        rfc_receptor: str,
        total: str | float,
        uuid: str,
        sello_ultimos_8: str | None = None,
    ) -> dict[str, Any]:
        """Valida un CFDI contra el servicio ConsultaCFDIService del SAT."""
        total_str = _normalize_total(total)
        expresion = f"re={rfc_emisor}&rr={rfc_receptor}&tt={total_str}&id={uuid}"
        if sello_ultimos_8:
            expresion += f"&fe={sello_ultimos_8}"

        try:
            result = self._client.service.Consulta(expresion)
        except Exception as e:
            logger.error(f"Error validando CFDI {uuid}: {e}")
            return {
                "CodigoEstatus": "",
                "Estado": "Error",
                "EsCancelable": "",
                "EstatusCancelacion": "",
                "ValidacionEFOS": "",
                "error": str(e),
            }

        return {
            "CodigoEstatus": getattr(result, "CodigoEstatus", "") or "",
            "Estado": getattr(result, "Estado", "") or "",
            "EsCancelable": getattr(result, "EsCancelable", "") or "",
            "EstatusCancelacion": getattr(result, "EstatusCancelacion", "") or "",
            "ValidacionEFOS": getattr(result, "ValidacionEFOS", "") or "",
        }

    def es_cfdi_valido(
        self,
        rfc_emisor: str,
        rfc_receptor: str,
        total: str | float,
        uuid: str,
        sello_ultimos_8: str | None = None,
        rechazar_efos: bool = True,
    ) -> bool:
        """Retorna True si el CFDI está vigente y no tiene problemas EFOS."""
        r = self.validar_cfdi(rfc_emisor, rfc_receptor, total, uuid, sello_ultimos_8)
        if r.get("error"):
            return False
        if r.get("Estado") != "Vigente":
            return False
        if rechazar_efos and self.tiene_problema_efos(r):
            return False
        return True

    def tiene_problema_efos(self, resultado: dict) -> bool:
        """Verifica si hay problemas EFOS en un resultado de validación."""
        v = (resultado.get("ValidacionEFOS") or "").upper()
        if not v:
            return False
        return "NO LOCALIZADO" in v or "CANCELADO" in v or "PLR" in v

    # ── Validación masiva ──

    def validar_cfdis_bulk(self, cfdis: list[dict]) -> list[dict]:
        """
        Valida múltiples CFDIs contra el SAT.
        Cada dict debe tener: rfc_emisor, rfc_receptor, total, uuid.
        """
        results = []
        for cfdi in cfdis:
            result = self.validar_cfdi(
                rfc_emisor=cfdi["rfc_emisor"],
                rfc_receptor=cfdi["rfc_receptor"],
                total=cfdi["total"],
                uuid=cfdi["uuid"],
                sello_ultimos_8=cfdi.get("sello_ultimos_8"),
            )
            result["uuid"] = cfdi["uuid"]
            result["is_valid"] = result.get("Estado") == "Vigente"
            result["has_efos_issue"] = self.tiene_problema_efos(result)
            results.append(result)
        return results

    # ── Parseo y almacenamiento de CFDI XML ──

    def parse_and_store_cfdi(self, xml_content: str, company_id: int | None = None) -> dict:
        """Parsea un XML CFDI y lo almacena en la base de datos local."""
        data = parse_cfdi_xml(xml_content)
        timbre = data.get("timbre", {})
        uuid = timbre.get("uuid", "")
        if not uuid:
            return {"error": "XML sin UUID de timbre fiscal"}

        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            existing = db.query(CfdiDocument).filter_by(uuid=uuid).first()
            if existing:
                return {"id": existing.id, "uuid": uuid, "status": "already_exists"}

            doc = CfdiDocument(
                company_id=company_id,
                uuid=uuid,
                tipo_comprobante=data.get("tipo_comprobante", ""),
                rfc_emisor=data.get("emisor", {}).get("rfc", ""),
                nombre_emisor=data.get("emisor", {}).get("nombre", ""),
                rfc_receptor=data.get("receptor", {}).get("rfc", ""),
                nombre_receptor=data.get("receptor", {}).get("nombre", ""),
                total=data.get("total", 0),
                subtotal=data.get("subtotal", 0),
                moneda=data.get("moneda", "MXN"),
                forma_pago=data.get("forma_pago", ""),
                metodo_pago=data.get("metodo_pago", ""),
                uso_cfdi=data.get("receptor", {}).get("uso_cfdi", ""),
                fecha_emision=_parse_datetime(data.get("fecha", "")),
                fecha_timbrado=_parse_datetime(timbre.get("fecha_timbrado", "")),
                sello_sat=timbre.get("sello_sat", ""),
                sello_cfdi=data.get("sello", ""),
                no_certificado_sat=timbre.get("no_certificado_sat", ""),
                no_certificado_emisor=data.get("no_certificado", ""),
                xml_content=xml_content,
            )
            db.add(doc)
            db.commit()
            db.refresh(doc)

            # Validar contra SAT automáticamente
            sat_result = self.validar_cfdi(
                rfc_emisor=doc.rfc_emisor,
                rfc_receptor=doc.rfc_receptor,
                total=doc.total or 0,
                uuid=uuid,
            )
            doc.sat_status = sat_result.get("Estado", "")
            doc.is_cancelable = sat_result.get("EsCancelable", "")
            doc.cancellation_status = sat_result.get("EstatusCancelacion", "")
            doc.efos_status = sat_result.get("ValidacionEFOS", "")
            doc.sat_last_check = datetime.now(timezone.utc)
            db.commit()

            return {
                "id": doc.id,
                "uuid": uuid,
                "status": "stored_and_validated",
                "sat_status": doc.sat_status,
                "efos_status": doc.efos_status,
                "tipo_comprobante": doc.tipo_comprobante,
                "emisor": doc.rfc_emisor,
                "receptor": doc.rfc_receptor,
                "total": doc.total,
            }
        finally:
            db.close()

    def get_stored_cfdis(
        self, company_id: int | None = None, limit: int = 100
    ) -> list[dict]:
        """Lista CFDIs almacenados en la base de datos local."""
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            query = db.query(CfdiDocument)
            if company_id:
                query = query.filter_by(company_id=company_id)
            docs = query.order_by(CfdiDocument.created_at.desc()).limit(limit).all()
            return [
                {
                    "id": d.id,
                    "uuid": d.uuid,
                    "tipo_comprobante": d.tipo_comprobante,
                    "rfc_emisor": d.rfc_emisor,
                    "nombre_emisor": d.nombre_emisor,
                    "rfc_receptor": d.rfc_receptor,
                    "total": d.total,
                    "moneda": d.moneda,
                    "sat_status": d.sat_status,
                    "efos_status": d.efos_status,
                    "fecha_emision": str(d.fecha_emision) if d.fecha_emision else None,
                }
                for d in docs
            ]
        finally:
            db.close()

    def revalidate_all(self, company_id: int | None = None) -> dict:
        """Revalida todos los CFDIs almacenados contra el SAT."""
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            query = db.query(CfdiDocument)
            if company_id:
                query = query.filter_by(company_id=company_id)
            docs = query.all()

            stats = {"total": len(docs), "valid": 0, "invalid": 0, "errors": 0}
            for doc in docs:
                if not doc.rfc_emisor or not doc.rfc_receptor or not doc.total:
                    stats["errors"] += 1
                    continue
                result = self.validar_cfdi(
                    rfc_emisor=doc.rfc_emisor,
                    rfc_receptor=doc.rfc_receptor,
                    total=doc.total,
                    uuid=doc.uuid,
                )
                doc.sat_status = result.get("Estado", "")
                doc.is_cancelable = result.get("EsCancelable", "")
                doc.cancellation_status = result.get("EstatusCancelacion", "")
                doc.efos_status = result.get("ValidacionEFOS", "")
                doc.sat_last_check = datetime.now(timezone.utc)

                if result.get("Estado") == "Vigente":
                    stats["valid"] += 1
                elif result.get("error"):
                    stats["errors"] += 1
                else:
                    stats["invalid"] += 1

            db.commit()
            return stats
        finally:
            db.close()


def _parse_datetime(s: str) -> datetime | None:
    if not s:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


# Singleton
_sat_service: SATService | None = None


def get_sat_service() -> SATService:
    global _sat_service
    if _sat_service is None:
        _sat_service = SATService()
    return _sat_service
