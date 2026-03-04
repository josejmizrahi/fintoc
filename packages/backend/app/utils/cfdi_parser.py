"""
Parser de XML CFDI 3.3 / 4.0 para extracción de datos fiscales.
Soporta: Comprobantes (I, E, P, N, T), Complemento de Pago, Nómina, etc.
"""

import xml.etree.ElementTree as ET
from datetime import datetime
from typing import Any, Optional

# Namespaces CFDI
NS = {
    "cfdi": "http://www.sat.gob.mx/cfd/4",
    "cfdi33": "http://www.sat.gob.mx/cfd/3",
    "tfd": "http://www.sat.gob.mx/TimbreFiscalDigital",
    "pago20": "http://www.sat.gob.mx/Pagos20",
    "pago10": "http://www.sat.gob.mx/Pagos",
    "nomina12": "http://www.sat.gob.mx/nomina12",
    "implocal": "http://www.sat.gob.mx/implocal",
    "cartaporte31": "http://www.sat.gob.mx/CartaPorte31",
    "cartaporte20": "http://www.sat.gob.mx/CartaPorte20",
}


def parse_cfdi_xml(xml_content: str) -> dict[str, Any]:
    """
    Parsea un XML CFDI completo y extrae todos los datos relevantes.
    Soporta CFDI 3.3 y 4.0.
    """
    root = ET.fromstring(xml_content)
    tag = root.tag

    # Detectar versión
    version = root.attrib.get("Version", root.attrib.get("version", ""))
    ns_prefix = "cfdi" if "cfd/4" in tag else "cfdi33"

    data = {
        "version": version,
        "serie": root.attrib.get("Serie", ""),
        "folio": root.attrib.get("Folio", ""),
        "fecha": root.attrib.get("Fecha", ""),
        "sello": root.attrib.get("Sello", ""),
        "no_certificado": root.attrib.get("NoCertificado", ""),
        "forma_pago": root.attrib.get("FormaPago", ""),
        "condiciones_pago": root.attrib.get("CondicionesDePago", ""),
        "subtotal": _safe_float(root.attrib.get("SubTotal", "0")),
        "descuento": _safe_float(root.attrib.get("Descuento", "0")),
        "moneda": root.attrib.get("Moneda", "MXN"),
        "tipo_cambio": _safe_float(root.attrib.get("TipoCambio", "1")),
        "total": _safe_float(root.attrib.get("Total", "0")),
        "tipo_comprobante": root.attrib.get("TipoDeComprobante", ""),
        "metodo_pago": root.attrib.get("MetodoPago", ""),
        "lugar_expedicion": root.attrib.get("LugarExpedicion", ""),
        "exportacion": root.attrib.get("Exportacion", ""),
    }

    # Emisor
    emisor = root.find(f"{{{NS[ns_prefix]}}}Emisor")
    if emisor is not None:
        data["emisor"] = {
            "rfc": emisor.attrib.get("Rfc", ""),
            "nombre": emisor.attrib.get("Nombre", ""),
            "regimen_fiscal": emisor.attrib.get("RegimenFiscal", ""),
        }
    else:
        data["emisor"] = {"rfc": "", "nombre": "", "regimen_fiscal": ""}

    # Receptor
    receptor = root.find(f"{{{NS[ns_prefix]}}}Receptor")
    if receptor is not None:
        data["receptor"] = {
            "rfc": receptor.attrib.get("Rfc", ""),
            "nombre": receptor.attrib.get("Nombre", ""),
            "uso_cfdi": receptor.attrib.get("UsoCFDI", ""),
            "domicilio_fiscal": receptor.attrib.get("DomicilioFiscalReceptor", ""),
            "regimen_fiscal": receptor.attrib.get("RegimenFiscalReceptor", ""),
        }
    else:
        data["receptor"] = {"rfc": "", "nombre": "", "uso_cfdi": ""}

    # Conceptos
    conceptos = []
    conceptos_node = root.find(f"{{{NS[ns_prefix]}}}Conceptos")
    if conceptos_node is not None:
        for concepto in conceptos_node.findall(f"{{{NS[ns_prefix]}}}Concepto"):
            c = {
                "clave_prod_serv": concepto.attrib.get("ClaveProdServ", ""),
                "cantidad": _safe_float(concepto.attrib.get("Cantidad", "0")),
                "clave_unidad": concepto.attrib.get("ClaveUnidad", ""),
                "unidad": concepto.attrib.get("Unidad", ""),
                "descripcion": concepto.attrib.get("Descripcion", ""),
                "valor_unitario": _safe_float(concepto.attrib.get("ValorUnitario", "0")),
                "importe": _safe_float(concepto.attrib.get("Importe", "0")),
                "descuento": _safe_float(concepto.attrib.get("Descuento", "0")),
                "objeto_imp": concepto.attrib.get("ObjetoImp", ""),
            }
            # Impuestos del concepto
            impuestos_node = concepto.find(f"{{{NS[ns_prefix]}}}Impuestos")
            if impuestos_node is not None:
                c["traslados"] = _parse_impuestos(impuestos_node, ns_prefix, "Traslados", "Traslado")
                c["retenciones"] = _parse_impuestos(impuestos_node, ns_prefix, "Retenciones", "Retencion")
            conceptos.append(c)
    data["conceptos"] = conceptos

    # Impuestos totales
    impuestos = root.find(f"{{{NS[ns_prefix]}}}Impuestos")
    if impuestos is not None:
        data["total_impuestos_trasladados"] = _safe_float(
            impuestos.attrib.get("TotalImpuestosTrasladados", "0")
        )
        data["total_impuestos_retenidos"] = _safe_float(
            impuestos.attrib.get("TotalImpuestosRetenidos", "0")
        )
    else:
        data["total_impuestos_trasladados"] = 0
        data["total_impuestos_retenidos"] = 0

    # Timbre Fiscal Digital
    timbre = _find_timbre(root)
    if timbre is not None:
        data["timbre"] = {
            "uuid": timbre.attrib.get("UUID", ""),
            "fecha_timbrado": timbre.attrib.get("FechaTimbrado", ""),
            "sello_sat": timbre.attrib.get("SelloSAT", ""),
            "no_certificado_sat": timbre.attrib.get("NoCertificadoSAT", ""),
            "sello_cfd": timbre.attrib.get("SelloCFD", ""),
            "rfc_prov_certif": timbre.attrib.get("RfcProvCertif", ""),
        }
    else:
        data["timbre"] = {}

    # Complemento de Pago
    pago_comp = _parse_complemento_pago(root)
    if pago_comp:
        data["complemento_pago"] = pago_comp

    # Nómina
    nomina = _parse_nomina(root)
    if nomina:
        data["nomina"] = nomina

    return data


def _parse_impuestos(node, ns_prefix: str, group: str, item: str) -> list[dict]:
    items = []
    group_node = node.find(f"{{{NS[ns_prefix]}}}{group}")
    if group_node is not None:
        for el in group_node.findall(f"{{{NS[ns_prefix]}}}{item}"):
            items.append({
                "base": _safe_float(el.attrib.get("Base", "0")),
                "impuesto": el.attrib.get("Impuesto", ""),
                "tipo_factor": el.attrib.get("TipoFactor", ""),
                "tasa_o_cuota": _safe_float(el.attrib.get("TasaOCuota", "0")),
                "importe": _safe_float(el.attrib.get("Importe", "0")),
            })
    return items


def _find_timbre(root) -> Optional[ET.Element]:
    """Busca el nodo TimbreFiscalDigital en cualquier nivel de Complemento."""
    for comp in root.iter():
        if "TimbreFiscalDigital" in comp.tag:
            return comp
    return None


def _parse_complemento_pago(root) -> Optional[dict]:
    """Extrae datos del Complemento de Pago 2.0 (o 1.0)."""
    for pago_node in root.iter():
        tag = pago_node.tag
        if "Pagos" in tag and ("Pagos20" in tag or "Pagos}" in tag):
            pagos = []
            for p in pago_node:
                if "Pago" in p.tag and "Pagos" not in p.tag:
                    pago_data = {
                        "fecha_pago": p.attrib.get("FechaPago", ""),
                        "forma_pago": p.attrib.get("FormaDePagoP", ""),
                        "moneda": p.attrib.get("MonedaP", "MXN"),
                        "tipo_cambio": _safe_float(p.attrib.get("TipoCambioP", "1")),
                        "monto": _safe_float(p.attrib.get("Monto", "0")),
                        "num_operacion": p.attrib.get("NumOperacion", ""),
                        "rfc_emisor_cta_ord": p.attrib.get("RfcEmisorCtaOrd", ""),
                        "nom_banco_ord": p.attrib.get("NomBancoOrdExt", ""),
                        "cta_ordenante": p.attrib.get("CtaOrdenante", ""),
                        "rfc_emisor_cta_ben": p.attrib.get("RfcEmisorCtaBen", ""),
                        "cta_beneficiario": p.attrib.get("CtaBeneficiario", ""),
                    }
                    # Documentos relacionados
                    docs = []
                    for dr in p:
                        if "DoctoRelacionado" in dr.tag:
                            docs.append({
                                "id_documento": dr.attrib.get("IdDocumento", ""),
                                "serie": dr.attrib.get("Serie", ""),
                                "folio": dr.attrib.get("Folio", ""),
                                "moneda": dr.attrib.get("MonedaDR", "MXN"),
                                "equivalencia": _safe_float(dr.attrib.get("EquivalenciaDR", "1")),
                                "num_parcialidad": dr.attrib.get("NumParcialidad", ""),
                                "imp_saldo_ant": _safe_float(dr.attrib.get("ImpSaldoAnt", "0")),
                                "imp_pagado": _safe_float(dr.attrib.get("ImpPagado", "0")),
                                "imp_saldo_insoluto": _safe_float(dr.attrib.get("ImpSaldoInsoluto", "0")),
                                "objeto_imp": dr.attrib.get("ObjetoImpDR", ""),
                            })
                    pago_data["documentos_relacionados"] = docs
                    pagos.append(pago_data)
            if pagos:
                return {"pagos": pagos}
    return None


def _parse_nomina(root) -> Optional[dict]:
    """Extrae datos básicos de complemento de Nómina 1.2."""
    for node in root.iter():
        if "nomina12" in node.tag.lower() or "Nomina" in node.tag:
            if node.attrib.get("Version") == "1.2" or node.attrib.get("TipoNomina"):
                return {
                    "tipo_nomina": node.attrib.get("TipoNomina", ""),
                    "fecha_pago": node.attrib.get("FechaPago", ""),
                    "fecha_inicial_pago": node.attrib.get("FechaInicialPago", ""),
                    "fecha_final_pago": node.attrib.get("FechaFinalPago", ""),
                    "num_dias_pagados": _safe_float(node.attrib.get("NumDiasPagados", "0")),
                    "total_percepciones": _safe_float(node.attrib.get("TotalPercepciones", "0")),
                    "total_deducciones": _safe_float(node.attrib.get("TotalDeducciones", "0")),
                    "total_otros_pagos": _safe_float(node.attrib.get("TotalOtrosPagos", "0")),
                }
    return None


def extract_uuid(xml_content: str) -> str:
    """Extrae el UUID del timbre fiscal de un XML CFDI."""
    data = parse_cfdi_xml(xml_content)
    return data.get("timbre", {}).get("uuid", "")


def extract_sello_last8(xml_content: str) -> str:
    """Extrae los últimos 8 caracteres del sello del CFDI."""
    root = ET.fromstring(xml_content)
    sello = root.attrib.get("Sello", "")
    return sello[-8:] if len(sello) >= 8 else sello


def _safe_float(val: str) -> float:
    try:
        return float(val)
    except (ValueError, TypeError):
        return 0.0
