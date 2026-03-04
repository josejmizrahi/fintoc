"""
Cliente SOAP para validar CFDIs contra el SAT (México).
Usa el servicio ConsultaCFDIService.
"""
from typing import Any

from zeep import Client
from zeep.transports import Transport
from requests import Session

WSDL_URL = "https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc?WSDL"

# Formato del total SAT: hasta 6 decimales, sin ceros no significativos
def _normalize_total(total: str | float) -> str:
    if isinstance(total, (int, float)):
        total = f"{float(total):.2f}"
    total = str(total).strip()
    # Quitar ceros trailing después del punto
    if "." in total:
        total = total.rstrip("0").rstrip(".")
    return total


class SATClient:
    def __init__(self):
        session = Session()
        session.verify = True
        transport = Transport(session=session)
        self._client = Client(WSDL_URL, transport=transport)

    def validar_cfdi(
        self,
        rfc_emisor: str,
        rfc_receptor: str,
        total: str | float,
        uuid: str,
        sello_ultimos_8: str | None = None,
    ) -> dict[str, Any]:
        """
        Valida un CFDI contra el SAT.

        Args:
            rfc_emisor: RFC del emisor (re)
            rfc_receptor: RFC del receptor (rr)
            total: Total del comprobante (tt). Se normaliza a formato SAT.
            uuid: UUID/Folio fiscal del CFDI (id)
            sello_ultimos_8: Últimos 8 caracteres del sello (fe). Opcional en muchas consultas.

        Returns:
            dict con CodigoEstatus, Estado, EsCancelable, EstatusCancelacion, ValidacionEFOS
        """
        total_str = _normalize_total(total)
        # Expresión impresa: re=X&rr=Y&tt=Z&id=UUID[&fe=...]
        expresion = f"re={rfc_emisor}&rr={rfc_receptor}&tt={total_str}&id={uuid}"
        if sello_ultimos_8:
            expresion += f"&fe={sello_ultimos_8}"

        try:
            result = self._client.service.Consulta(expresion)
        except Exception as e:
            return {
                "CodigoEstatus": "",
                "Estado": "Error",
                "EsCancelable": "",
                "EstatusCancelacion": "",
                "ValidacionEFOS": "",
                "error": str(e),
            }

        # zeep devuelve un objeto con atributos
        out = {
            "CodigoEstatus": getattr(result, "CodigoEstatus", "") or "",
            "Estado": getattr(result, "Estado", "") or "",
            "EsCancelable": getattr(result, "EsCancelable", "") or "",
            "EstatusCancelacion": getattr(result, "EstatusCancelacion", "") or "",
            "ValidacionEFOS": getattr(result, "ValidacionEFOS", "") or "",
        }
        return out

    def es_cfdi_valido(
        self,
        rfc_emisor: str,
        rfc_receptor: str,
        total: str | float,
        uuid: str,
        sello_ultimos_8: str | None = None,
        rechazar_efos: bool = True,
    ) -> bool:
        """
        Wrapper que retorna True si el CFDI está vigente y (opcional) no está en lista EFOS.

        Args:
            rechazar_efos: Si True, retorna False cuando ValidacionEFOS indica problema.
        """
        r = self.validar_cfdi(rfc_emisor, rfc_receptor, total, uuid, sello_ultimos_8)
        if r.get("error"):
            return False
        if r.get("Estado") != "Vigente":
            return False
        if rechazar_efos and r.get("ValidacionEFOS"):
            # Si el SAT devuelve algo en ValidacionEFOS que indique problema (ej. listado negativo)
            v = (r.get("ValidacionEFOS") or "").upper()
            if "NO LOCALIZADO" in v or "CANCELADO" in v or "PLR" in v:
                return False
        return True

    def verificar_efos(self, resultado_consulta: dict[str, Any]) -> bool:
        """
        Verifica si el resultado de validar_cfdi indica que el emisor está en lista EFOS
        o tiene algún problema de validación.

        Args:
            resultado_consulta: dict devuelto por validar_cfdi().

        Returns:
            True si hay problema EFOS o similar, False si está bien.
        """
        v = (resultado_consulta.get("ValidacionEFOS") or "").upper()
        if not v:
            return False
        # Indicadores de problema
        if "NO LOCALIZADO" in v or "CANCELADO" in v or "PLR" in v:
            return True
        return False


# Singleton para uso directo
_sat_client: SATClient | None = None


def get_sat_client() -> SATClient:
    global _sat_client
    if _sat_client is None:
        _sat_client = SATClient()
    return _sat_client


def validar_cfdi(
    rfc_emisor: str,
    rfc_receptor: str,
    total: str | float,
    uuid: str,
    sello_ultimos_8: str | None = None,
) -> dict[str, Any]:
    """Función de conveniencia que usa el cliente por defecto."""
    return get_sat_client().validar_cfdi(
        rfc_emisor, rfc_receptor, total, uuid, sello_ultimos_8
    )


def es_cfdi_valido(
    rfc_emisor: str,
    rfc_receptor: str,
    total: str | float,
    uuid: str,
    sello_ultimos_8: str | None = None,
    rechazar_efos: bool = True,
) -> bool:
    """Función de conveniencia que usa el cliente por defecto."""
    return get_sat_client().es_cfdi_valido(
        rfc_emisor, rfc_receptor, total, uuid, sello_ultimos_8, rechazar_efos
    )
