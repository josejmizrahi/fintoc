/**
 * SAT CFDI Services — Complete implementation
 *
 * Includes:
 * - CFDI XML parsing (full Anexo 20 / CFDI 4.0)
 * - SAT Consulta Estado CFDI (v1.3) with EFOS detection
 * - RFC validation
 * - EFOS status interpretation (200-204 codes)
 * - Descarga Masiva SOAP client (v1.5)
 * - Cancellation request helpers
 */

import { withRetry } from "./retry";

// ── Constants ──

const SAT_SOAP_URL = "https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc";
const SAT_SOAP_ACTION = "http://tempuri.org/IConsultaCFDIService/Consulta";

// Descarga Masiva v1.5 endpoints (updated /4/ URIs)
export const DESCARGA_MASIVA_URLS = {
  autenticacion: "https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/4/Autenticacion/Autenticacion.svc",
  solicitudEmitidos: "https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/4/SolicitaDescargaEmitidos",
  solicitudRecibidos: "https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/4/SolicitaDescargaRecibidos",
  verificacion: "https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/4/VerificaSolicitudDescarga",
  descarga: "https://cfdidescargamasiva.clouda.sat.gob.mx/4/DescargaMasivaCFDI",
} as const;

// EFOS status codes from SAT ConsultaCFDI ValidacionEFOS field
export const EFOS_CODES: Record<string, { status: EfosStatus; label: string; safe: boolean }> = {
  "200": { status: "clean", label: "No en lista 69-B", safe: true },
  "201": { status: "presumed", label: "Presunto (bajo investigacion)", safe: false },
  "202": { status: "disproved", label: "Desvirtuado", safe: true },
  "203": { status: "definitive", label: "Definitivo (empresa fantasma)", safe: false },
  "204": { status: "favorable", label: "Sentencia favorable", safe: true },
};

// Tipo de Comprobante labels
export const TIPO_COMPROBANTE: Record<string, string> = {
  I: "Ingreso",
  E: "Egreso",
  T: "Traslado",
  N: "Nomina",
  P: "Pago",
};

// Metodo de Pago labels
export const METODO_PAGO: Record<string, string> = {
  PUE: "Pago en Una sola Exhibicion",
  PPD: "Pago en Parcialidades o Diferido",
};

// Forma de Pago labels
export const FORMA_PAGO: Record<string, string> = {
  "01": "Efectivo",
  "02": "Cheque nominativo",
  "03": "Transferencia electronica",
  "04": "Tarjeta de credito",
  "05": "Monedero electronico",
  "06": "Dinero electronico",
  "08": "Vales de despensa",
  "12": "Dacion en pago",
  "13": "Pago por subrogacion",
  "14": "Pago por consignacion",
  "15": "Condonacion",
  "17": "Compensacion",
  "23": "Novacion",
  "24": "Confusion",
  "25": "Remision de deuda",
  "26": "Prescripcion o caducidad",
  "27": "A satisfaccion del acreedor",
  "28": "Tarjeta de debito",
  "29": "Tarjeta de servicios",
  "30": "Aplicacion de anticipos",
  "31": "Intermediario pagos",
  "99": "Por definir",
};

// Uso CFDI labels
export const USO_CFDI: Record<string, string> = {
  G01: "Adquisicion de mercancias",
  G02: "Devoluciones, descuentos o bonificaciones",
  G03: "Gastos en general",
  I01: "Construcciones",
  I02: "Mobiliario y equipo de oficina",
  I03: "Equipo de transporte",
  I04: "Equipo de computo",
  I05: "Dados, troqueles, moldes, matrices y herramental",
  I06: "Comunicaciones telefonicas",
  I07: "Comunicaciones satelitales",
  I08: "Otra maquinaria y equipo",
  D01: "Honorarios medicos, dentales y gastos hospitalarios",
  D02: "Gastos medicos por incapacidad o discapacidad",
  D03: "Gastos funerales",
  D04: "Donativos",
  D05: "Intereses reales efectivamente pagados por creditos hipotecarios",
  D06: "Aportaciones voluntarias al SAR",
  D07: "Primas por seguros de gastos medicos",
  D08: "Gastos de transportacion escolar obligatoria",
  D09: "Depositos en cuentas para el ahorro",
  D10: "Pagos por servicios educativos (colegiaturas)",
  P01: "Por definir",
  S01: "Sin efectos fiscales",
  CP01: "Pagos",
  CN01: "Nomina",
};

// Regimen Fiscal labels
export const REGIMEN_FISCAL: Record<string, string> = {
  "601": "General de Ley Personas Morales",
  "603": "Personas Morales con Fines no Lucrativos",
  "605": "Sueldos y Salarios e Ingresos Asimilados a Salarios",
  "606": "Arrendamiento",
  "607": "Regimen de Enajenacion o Adquisicion de Bienes",
  "608": "Demas ingresos",
  "610": "Residentes en el Extranjero sin Establecimiento Permanente en Mexico",
  "611": "Ingresos por Dividendos (socios y accionistas)",
  "612": "Personas Fisicas con Actividades Empresariales y Profesionales",
  "614": "Ingresos por intereses",
  "615": "Regimen de los ingresos por obtencion de premios",
  "616": "Sin obligaciones fiscales",
  "620": "Sociedades Cooperativas de Produccion",
  "621": "Incorporacion Fiscal",
  "622": "Actividades Agricolas, Ganaderas, Silvicolas y Pesqueras",
  "623": "Opcional para Grupos de Sociedades",
  "624": "Coordinados",
  "625": "Regimen de las Actividades Empresariales con ingresos a traves de Plataformas Tecnologicas",
  "626": "Regimen Simplificado de Confianza",
};

// Cancellation motivos
export const MOTIVOS_CANCELACION: Record<string, { label: string; requiereUuidSustitucion: boolean }> = {
  "01": { label: "Comprobante emitido con errores con relacion", requiereUuidSustitucion: true },
  "02": { label: "Comprobante emitido con errores sin relacion", requiereUuidSustitucion: false },
  "03": { label: "No se llevo a cabo la operacion", requiereUuidSustitucion: false },
  "04": { label: "Operacion nominativa relacionada en la factura global", requiereUuidSustitucion: false },
};

// ── Types ──

export type EfosStatus = "clean" | "presumed" | "definitive" | "disproved" | "favorable" | "unknown";
export type TipoComprobante = "I" | "E" | "T" | "N" | "P";
export type CfdiEstado = "Vigente" | "Cancelado" | "No encontrado" | "Sin verificar" | "Error";

export interface CfdiImpuesto {
  base: number;
  impuesto: string;
  tipoFactor: string;
  tasaOCuota: number;
  importe: number;
}

export interface CfdiConcepto {
  claveProdServ: string;
  cantidad: number;
  claveUnidad: string;
  unidad: string;
  descripcion: string;
  valorUnitario: number;
  importe: number;
  descuento: number;
  objetoImp: string;
  traslados: CfdiImpuesto[];
  retenciones: CfdiImpuesto[];
}

export interface DoctoRelacionado {
  idDocumento: string;
  serie: string;
  folio: string;
  moneda: string;
  equivalencia: number;
  numParcialidad: string;
  impSaldoAnt: number;
  impPagado: number;
  impSaldoInsoluto: number;
  objetoImp: string;
}

export interface PagoDetalle {
  fechaPago: string;
  formaPago: string;
  moneda: string;
  tipoCambio: number;
  monto: number;
  numOperacion: string;
  rfcEmisorCtaOrd: string;
  nomBancoOrd: string;
  ctaOrdenante: string;
  rfcEmisorCtaBen: string;
  ctaBeneficiario: string;
  documentosRelacionados: DoctoRelacionado[];
}

export interface ComplementoPago {
  pagos: PagoDetalle[];
}

export interface ComplementoNomina {
  tipoNomina: string;
  fechaPago: string;
  fechaInicialPago: string;
  fechaFinalPago: string;
  numDiasPagados: number;
  totalPercepciones: number;
  totalDeducciones: number;
  totalOtrosPagos: number;
}

export interface TimbreFiscalDigital {
  uuid: string;
  fechaTimbrado: string;
  selloSat: string;
  selloCfd: string;
  noCertificadoSat: string;
  rfcProvCertif: string;
}

export interface ParsedCfdi {
  // Comprobante root
  version: string;
  serie: string;
  folio: string;
  fecha: string;
  sello: string;
  noCertificado: string;
  formaPago: string;
  condicionesPago: string;
  subtotal: number;
  descuento: number;
  moneda: string;
  tipoCambio: number;
  total: number;
  tipoComprobante: string;
  metodoPago: string;
  lugarExpedicion: string;
  exportacion: string;
  // Emisor
  rfcEmisor: string;
  nombreEmisor: string;
  regimenFiscal: string;
  // Receptor
  rfcReceptor: string;
  nombreReceptor: string;
  usoCfdi: string;
  domicilioFiscalReceptor: string;
  regimenFiscalReceptor: string;
  // Timbre
  uuid: string;
  fechaTimbrado: string;
  timbre: TimbreFiscalDigital | null;
  // Conceptos
  conceptos: CfdiConcepto[];
  // Impuestos totales
  totalImpuestosTrasladados: number;
  totalImpuestosRetenidos: number;
  // Complementos
  complementoPago: ComplementoPago | null;
  complementoNomina: ComplementoNomina | null;
}

export interface SatValidationResult {
  uuid: string;
  codigoEstatus: string;
  estado: CfdiEstado;
  esCancelable: string;
  estatusCancelacion: string;
  validacionEfos: string;
  efosCode: string;
  efosStatus: EfosStatus;
  efosSafe: boolean;
  isValid: boolean;
  hasEfosIssue: boolean;
  consultaDate: string;
}

export interface DescargaMasivaRequest {
  fechaInicio: string;
  fechaFin: string;
  tipoSolicitud: "CFDI" | "Metadata";
  tipoComprobante?: TipoComprobante;
  estadoComprobante?: "0" | "1";
  rfcEmisor?: string;
  rfcReceptor?: string;
  rfcACuentaTerceros?: string;
  complemento?: string;
}

export interface CancellationRequest {
  uuid: string;
  motivo: "01" | "02" | "03" | "04";
  uuidSustitucion?: string;
}

// ── XML Escaping ──

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── XML Parsing Helpers ──

function getAttr(elementStr: string, attr: string): string {
  const regex = new RegExp(`${attr}=["']([^"']*)["']`, "i");
  const match = elementStr.match(regex);
  return match?.[1] || "";
}

function safeFloat(val: string): number {
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

function extractElement(xml: string, localName: string): string | null {
  const openRegex = new RegExp(`<([\\w]+:)?${localName}[\\s>/]`, "i");
  const openMatch = xml.match(openRegex);
  if (!openMatch) return null;

  const startIdx = xml.indexOf(openMatch[0], openMatch.index);
  if (startIdx === -1) return null;

  const fromStart = xml.substring(startIdx);
  const selfClose = fromStart.match(/^<[^>]*\/>/);
  if (selfClose) return selfClose[0];

  const prefix = openMatch[1] || "";
  const closeTag = `</${prefix}${localName}>`;
  const closeIdx = xml.indexOf(closeTag, startIdx);
  if (closeIdx === -1) {
    const altClose = `</${localName}>`;
    const altIdx = xml.indexOf(altClose, startIdx);
    if (altIdx === -1) return fromStart.match(/^<[^>]*>/)?.[0] || null;
    return xml.substring(startIdx, altIdx + altClose.length);
  }
  return xml.substring(startIdx, closeIdx + closeTag.length);
}

function extractAllElements(xml: string, localName: string): string[] {
  const results: string[] = [];
  const regex = new RegExp(`<([\\w]+:)?${localName}[\\s>]`, "gi");
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const startIdx = match.index;
    const fromStart = xml.substring(startIdx);

    const selfClose = fromStart.match(/^<[^>]*\/>/);
    if (selfClose) {
      results.push(selfClose[0]);
      continue;
    }

    const prefix = match[1] || "";
    const closeTag = `</${prefix}${localName}>`;
    const closeIdx = xml.indexOf(closeTag, startIdx);
    if (closeIdx !== -1) {
      results.push(xml.substring(startIdx, closeIdx + closeTag.length));
    } else {
      const altClose = `</${localName}>`;
      const altIdx = xml.indexOf(altClose, startIdx);
      if (altIdx !== -1) {
        results.push(xml.substring(startIdx, altIdx + altClose.length));
      } else {
        const openTag = fromStart.match(/^<[^>]*>/);
        if (openTag) results.push(openTag[0]);
      }
    }
  }
  return results;
}

// ── CFDI XML Parser (Complete Anexo 20 / CFDI 4.0) ──

export function parseCfdiXml(xml: string): ParsedCfdi {
  const rootMatch = xml.match(/<([^>]*Comprobante[^>]*)>/i);
  const rootTag = rootMatch?.[1] || "";

  // Emisor
  const emisorBlock = extractElement(xml, "Emisor") || "";
  const rfcEmisor = getAttr(emisorBlock, "Rfc");
  const nombreEmisor = getAttr(emisorBlock, "Nombre");
  const regimenFiscal = getAttr(emisorBlock, "RegimenFiscal");

  // Receptor
  const receptorBlock = extractElement(xml, "Receptor") || "";
  const rfcReceptor = getAttr(receptorBlock, "Rfc");
  const nombreReceptor = getAttr(receptorBlock, "Nombre");
  const usoCfdi = getAttr(receptorBlock, "UsoCFDI");
  const domicilioFiscalReceptor = getAttr(receptorBlock, "DomicilioFiscalReceptor");
  const regimenFiscalReceptor = getAttr(receptorBlock, "RegimenFiscalReceptor");

  // Timbre Fiscal Digital
  const timbreBlock = extractElement(xml, "TimbreFiscalDigital") || "";
  const uuid = getAttr(timbreBlock, "UUID");
  const fechaTimbrado = getAttr(timbreBlock, "FechaTimbrado");
  const timbre: TimbreFiscalDigital | null = uuid ? {
    uuid,
    fechaTimbrado,
    selloSat: getAttr(timbreBlock, "SelloSAT"),
    selloCfd: getAttr(timbreBlock, "SelloCFD"),
    noCertificadoSat: getAttr(timbreBlock, "NoCertificadoSAT"),
    rfcProvCertif: getAttr(timbreBlock, "RfcProvCertif"),
  } : null;

  // Conceptos
  const conceptos = parseConceptos(xml);

  // Impuestos totales (root level)
  const rootImpuestos = findRootImpuestos(xml);
  const totalImpuestosTrasladados = safeFloat(getAttr(rootImpuestos || "", "TotalImpuestosTrasladados"));
  const totalImpuestosRetenidos = safeFloat(getAttr(rootImpuestos || "", "TotalImpuestosRetenidos"));

  // Complemento de Pago
  const complementoPago = parseComplementoPago(xml);

  // Complemento Nomina
  const complementoNomina = parseComplementoNomina(xml);

  return {
    version: getAttr(rootTag, "Version") || getAttr(rootTag, "version"),
    serie: getAttr(rootTag, "Serie"),
    folio: getAttr(rootTag, "Folio"),
    fecha: getAttr(rootTag, "Fecha"),
    sello: getAttr(rootTag, "Sello"),
    noCertificado: getAttr(rootTag, "NoCertificado"),
    formaPago: getAttr(rootTag, "FormaPago"),
    condicionesPago: getAttr(rootTag, "CondicionesDePago"),
    subtotal: safeFloat(getAttr(rootTag, "SubTotal")),
    descuento: safeFloat(getAttr(rootTag, "Descuento")),
    moneda: getAttr(rootTag, "Moneda") || "MXN",
    tipoCambio: safeFloat(getAttr(rootTag, "TipoCambio")) || 1,
    total: safeFloat(getAttr(rootTag, "Total")),
    tipoComprobante: getAttr(rootTag, "TipoDeComprobante"),
    metodoPago: getAttr(rootTag, "MetodoPago"),
    lugarExpedicion: getAttr(rootTag, "LugarExpedicion"),
    exportacion: getAttr(rootTag, "Exportacion"),
    rfcEmisor,
    nombreEmisor,
    regimenFiscal,
    rfcReceptor,
    nombreReceptor,
    usoCfdi,
    domicilioFiscalReceptor,
    regimenFiscalReceptor,
    uuid,
    fechaTimbrado,
    timbre,
    conceptos,
    totalImpuestosTrasladados,
    totalImpuestosRetenidos,
    complementoPago,
    complementoNomina,
  };
}

function findRootImpuestos(xml: string): string | null {
  const allImpuestos = extractAllElements(xml, "Impuestos");
  for (const block of allImpuestos) {
    if (block.includes("TotalImpuestosTrasladados") || block.includes("TotalImpuestosRetenidos")) {
      return block;
    }
  }
  return allImpuestos[allImpuestos.length - 1] || null;
}

function parseConceptos(xml: string): CfdiConcepto[] {
  const conceptosBlock = extractElement(xml, "Conceptos");
  if (!conceptosBlock) return [];

  const conceptoElements = extractAllElements(conceptosBlock, "Concepto");
  return conceptoElements.map((el) => {
    const traslados = parseImpuestoItems(el, "Traslado");
    const retenciones = parseImpuestoItems(el, "Retencion");

    return {
      claveProdServ: getAttr(el, "ClaveProdServ"),
      cantidad: safeFloat(getAttr(el, "Cantidad")),
      claveUnidad: getAttr(el, "ClaveUnidad"),
      unidad: getAttr(el, "Unidad"),
      descripcion: getAttr(el, "Descripcion"),
      valorUnitario: safeFloat(getAttr(el, "ValorUnitario")),
      importe: safeFloat(getAttr(el, "Importe")),
      descuento: safeFloat(getAttr(el, "Descuento")),
      objetoImp: getAttr(el, "ObjetoImp"),
      traslados,
      retenciones,
    };
  });
}

function parseImpuestoItems(xml: string, itemName: string): CfdiImpuesto[] {
  const items = extractAllElements(xml, itemName);
  return items.map((el) => ({
    base: safeFloat(getAttr(el, "Base")),
    impuesto: getAttr(el, "Impuesto"),
    tipoFactor: getAttr(el, "TipoFactor"),
    tasaOCuota: safeFloat(getAttr(el, "TasaOCuota")),
    importe: safeFloat(getAttr(el, "Importe")),
  }));
}

function parseComplementoPago(xml: string): ComplementoPago | null {
  const pagosBlock = extractElement(xml, "Pagos");
  if (!pagosBlock) return null;

  const pagoElements = extractAllElements(pagosBlock, "Pago");
  const realPagos = pagoElements.filter(el => !el.match(/<[^>]*Pagos[\s>]/i));

  if (realPagos.length === 0) return null;

  const pagos: PagoDetalle[] = realPagos.map((el) => {
    const doctos = extractAllElements(el, "DoctoRelacionado");
    return {
      fechaPago: getAttr(el, "FechaPago"),
      formaPago: getAttr(el, "FormaDePagoP"),
      moneda: getAttr(el, "MonedaP") || "MXN",
      tipoCambio: safeFloat(getAttr(el, "TipoCambioP")) || 1,
      monto: safeFloat(getAttr(el, "Monto")),
      numOperacion: getAttr(el, "NumOperacion"),
      rfcEmisorCtaOrd: getAttr(el, "RfcEmisorCtaOrd"),
      nomBancoOrd: getAttr(el, "NomBancoOrdExt"),
      ctaOrdenante: getAttr(el, "CtaOrdenante"),
      rfcEmisorCtaBen: getAttr(el, "RfcEmisorCtaBen"),
      ctaBeneficiario: getAttr(el, "CtaBeneficiario"),
      documentosRelacionados: doctos.map((dr) => ({
        idDocumento: getAttr(dr, "IdDocumento"),
        serie: getAttr(dr, "Serie"),
        folio: getAttr(dr, "Folio"),
        moneda: getAttr(dr, "MonedaDR") || "MXN",
        equivalencia: safeFloat(getAttr(dr, "EquivalenciaDR")) || 1,
        numParcialidad: getAttr(dr, "NumParcialidad"),
        impSaldoAnt: safeFloat(getAttr(dr, "ImpSaldoAnt")),
        impPagado: safeFloat(getAttr(dr, "ImpPagado")),
        impSaldoInsoluto: safeFloat(getAttr(dr, "ImpSaldoInsoluto")),
        objetoImp: getAttr(dr, "ObjetoImpDR"),
      })),
    };
  });

  return pagos.length > 0 ? { pagos } : null;
}

function parseComplementoNomina(xml: string): ComplementoNomina | null {
  const nominaBlock = extractElement(xml, "Nomina");
  if (!nominaBlock) return null;

  const tipoNomina = getAttr(nominaBlock, "TipoNomina");
  if (!tipoNomina) return null;

  return {
    tipoNomina,
    fechaPago: getAttr(nominaBlock, "FechaPago"),
    fechaInicialPago: getAttr(nominaBlock, "FechaInicialPago"),
    fechaFinalPago: getAttr(nominaBlock, "FechaFinalPago"),
    numDiasPagados: safeFloat(getAttr(nominaBlock, "NumDiasPagados")),
    totalPercepciones: safeFloat(getAttr(nominaBlock, "TotalPercepciones")),
    totalDeducciones: safeFloat(getAttr(nominaBlock, "TotalDeducciones")),
    totalOtrosPagos: safeFloat(getAttr(nominaBlock, "TotalOtrosPagos")),
  };
}

// ── SAT Consulta Estado CFDI (v1.3) ──

export async function validateCfdiAgainstSat(
  uuid: string,
  rfcEmisor: string,
  rfcReceptor: string,
  total: string,
  timeout = 10000,
): Promise<string> {
  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
  <soap:Body>
    <tem:Consulta>
      <tem:expresionImpresa>?re=${escapeXml(rfcEmisor)}&amp;rr=${escapeXml(rfcReceptor)}&amp;tt=${escapeXml(total)}&amp;id=${escapeXml(uuid)}</tem:expresionImpresa>
    </tem:Consulta>
  </soap:Body>
</soap:Envelope>`;

  try {
    return await withRetry(async () => {
      const res = await fetch(SAT_SOAP_URL, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: SAT_SOAP_ACTION,
        },
        body: soapEnvelope,
        signal: AbortSignal.timeout(timeout),
      });

      if (!res.ok) return "Error";

      const text = await res.text();
      if (text.includes("Vigente")) return "Vigente";
      if (text.includes("Cancelado")) return "Cancelado";
      if (text.includes("No Encontrado")) return "No encontrado";
      return "Sin verificar";
    }, { maxRetries: 2, retryOn: (err) => err instanceof Error && err.message.includes("timeout") });
  } catch {
    return "Sin verificar";
  }
}

/**
 * Full SAT validation returning all fields including EFOS.
 */
export async function validateCfdiFullResponse(
  uuid: string,
  rfcEmisor: string,
  rfcReceptor: string,
  total: string,
  timeout = 10000,
): Promise<SatValidationResult> {
  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
  <soap:Body>
    <tem:Consulta>
      <tem:expresionImpresa>?re=${escapeXml(rfcEmisor)}&amp;rr=${escapeXml(rfcReceptor)}&amp;tt=${escapeXml(total)}&amp;id=${escapeXml(uuid)}</tem:expresionImpresa>
    </tem:Consulta>
  </soap:Body>
</soap:Envelope>`;

  const defaultResult: SatValidationResult = {
    uuid,
    codigoEstatus: "",
    estado: "Sin verificar",
    esCancelable: "",
    estatusCancelacion: "",
    validacionEfos: "",
    efosCode: "",
    efosStatus: "unknown",
    efosSafe: true,
    isValid: false,
    hasEfosIssue: false,
    consultaDate: new Date().toISOString(),
  };

  try {
    return await withRetry(async () => {
      const res = await fetch(SAT_SOAP_URL, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: SAT_SOAP_ACTION,
        },
        body: soapEnvelope,
        signal: AbortSignal.timeout(timeout),
      });

      if (!res.ok) return { ...defaultResult, estado: "Error" as CfdiEstado };

      const text = await res.text();
      return parseSatConsultaResponse(uuid, text);
    }, { maxRetries: 2, retryOn: (err) => err instanceof Error && err.message.includes("timeout") });
  } catch {
    return defaultResult;
  }
}

export function parseSatConsultaResponse(uuid: string, soapXml: string): SatValidationResult {
  const extractField = (fieldName: string): string => {
    const regex = new RegExp(`<[^>]*${fieldName}[^>]*>([^<]*)<`, "i");
    const match = soapXml.match(regex);
    if (match) return match[1].trim();
    const attrRegex = new RegExp(`${fieldName}=["']([^"']*)["']`, "i");
    const attrMatch = soapXml.match(attrRegex);
    return attrMatch?.[1]?.trim() || "";
  };

  const codigoEstatus = extractField("CodigoEstatus") || extractField("a:CodigoEstatus");
  const estado = extractField("Estado") || extractField("a:Estado");
  const esCancelable = extractField("EsCancelable") || extractField("a:EsCancelable");
  const estatusCancelacion = extractField("EstatusCancelacion") || extractField("a:EstatusCancelacion");
  const validacionEfos = extractField("ValidacionEFOS") || extractField("a:ValidacionEFOS");

  const efosInfo = parseEfosCode(validacionEfos);

  let cfdiEstado: CfdiEstado = "Sin verificar";
  if (estado.includes("Vigente") || soapXml.includes("Vigente")) cfdiEstado = "Vigente";
  else if (estado.includes("Cancelado") || soapXml.includes("Cancelado")) cfdiEstado = "Cancelado";
  else if (estado.includes("No Encontrado") || soapXml.includes("No Encontrado")) cfdiEstado = "No encontrado";

  return {
    uuid,
    codigoEstatus,
    estado: cfdiEstado,
    esCancelable,
    estatusCancelacion,
    validacionEfos,
    efosCode: efosInfo.code,
    efosStatus: efosInfo.status,
    efosSafe: efosInfo.safe,
    isValid: cfdiEstado === "Vigente",
    hasEfosIssue: !efosInfo.safe,
    consultaDate: new Date().toISOString(),
  };
}

// ── EFOS Interpretation ──

export function parseEfosCode(validacionEfos: string): { code: string; status: EfosStatus; safe: boolean; label: string } {
  if (!validacionEfos) {
    return { code: "", status: "unknown", safe: true, label: "Sin informacion" };
  }

  const codeMatch = validacionEfos.match(/\b(200|201|202|203|204)\b/);
  if (codeMatch) {
    const code = codeMatch[1];
    const info = EFOS_CODES[code];
    if (info) return { code, ...info };
  }

  const upper = validacionEfos.toUpperCase();
  if (upper.includes("NO EN LISTA") || upper.includes("200")) return { code: "200", ...EFOS_CODES["200"] };
  if (upper.includes("PRESUNTO") || upper.includes("201")) return { code: "201", ...EFOS_CODES["201"] };
  if (upper.includes("DESVIRTUADO") || upper.includes("202")) return { code: "202", ...EFOS_CODES["202"] };
  if (upper.includes("DEFINITIVO") || upper.includes("203")) return { code: "203", ...EFOS_CODES["203"] };
  if (upper.includes("SENTENCIA") || upper.includes("204")) return { code: "204", ...EFOS_CODES["204"] };

  return { code: "", status: "unknown", safe: true, label: validacionEfos };
}

export function isEfosRisk(efosStatus: EfosStatus): boolean {
  return efosStatus === "presumed" || efosStatus === "definitive";
}

export function isEfosNonDeductible(efosStatus: EfosStatus): boolean {
  return efosStatus === "definitive";
}

// ── SAT Reachability Test ──

export async function testSatReachability(rfcEmisor: string): Promise<boolean> {
  try {
    const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
  <soap:Body>
    <tem:Consulta>
      <tem:expresionImpresa>?re=${escapeXml(rfcEmisor)}&amp;rr=${escapeXml(rfcEmisor)}&amp;tt=0.00&amp;id=00000000-0000-0000-0000-000000000000</tem:expresionImpresa>
    </tem:Consulta>
  </soap:Body>
</soap:Envelope>`;

    const res = await fetch(SAT_SOAP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: SAT_SOAP_ACTION,
      },
      body: soapEnvelope,
      signal: AbortSignal.timeout(15000),
    });

    return res.ok || res.status === 500;
  } catch {
    return false;
  }
}

// ── RFC Validation ──

export function validateRfcFormat(rfc: string): { valid: boolean; type: "moral" | "fisica" | "generico" | "extranjero" | "invalid" } {
  if (!rfc) return { valid: false, type: "invalid" };
  const trimmed = rfc.trim().toUpperCase();

  if (trimmed === "XAXX010101000") return { valid: true, type: "generico" };
  if (trimmed === "XEXX010101000") return { valid: true, type: "extranjero" };

  const moralRegex = /^[A-Z&Ñ]{3}\d{6}[A-Z0-9]{3}$/;
  if (moralRegex.test(trimmed)) return { valid: true, type: "moral" };

  const fisicaRegex = /^[A-Z&Ñ]{4}\d{6}[A-Z0-9]{3}$/;
  if (fisicaRegex.test(trimmed)) return { valid: true, type: "fisica" };

  return { valid: false, type: "invalid" };
}

// ── Descarga Masiva SOAP Envelope Builders ──

export function buildAuthenticationEnvelope(
  certBase64: string,
  timestamp: { created: string; expires: string },
): string {
  return `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:u="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
  <s:Header>
    <o:Security xmlns:o="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" s:mustUnderstand="1">
      <u:Timestamp u:Id="_0">
        <u:Created>${timestamp.created}</u:Created>
        <u:Expires>${timestamp.expires}</u:Expires>
      </u:Timestamp>
      <o:BinarySecurityToken u:Id="BinaryToken" ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3" EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${certBase64}</o:BinarySecurityToken>
    </o:Security>
  </s:Header>
  <s:Body>
    <Autentica xmlns="http://DescargaMasivaTerceros.gob.mx"/>
  </s:Body>
</s:Envelope>`;
}

export function buildSolicitudEmitidosEnvelope(
  token: string,
  rfcSolicitante: string,
  params: DescargaMasivaRequest,
): string {
  let attrs = `RfcSolicitante="${escapeXml(rfcSolicitante)}"`;
  attrs += ` FechaInicio="${escapeXml(params.fechaInicio)}"`;
  attrs += ` FechaFin="${escapeXml(params.fechaFin)}"`;
  attrs += ` TipoSolicitud="${escapeXml(params.tipoSolicitud)}"`;
  if (params.tipoComprobante) attrs += ` TipoComprobante="${escapeXml(params.tipoComprobante)}"`;
  if (params.estadoComprobante) attrs += ` EstadoComprobante="${escapeXml(params.estadoComprobante)}"`;
  if (params.rfcEmisor) attrs += ` RfcEmisor="${escapeXml(params.rfcEmisor)}"`;
  if (params.complemento) attrs += ` Complemento="${escapeXml(params.complemento)}"`;
  if (params.rfcACuentaTerceros) attrs += ` RfcACuentaTerceros="${escapeXml(params.rfcACuentaTerceros)}"`;

  return `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:des="http://DescargaMasivaTerceros.sat.gob.mx" xmlns:xd="http://www.w3.org/2000/09/xmldsig#">
  <s:Header/>
  <s:Body>
    <des:SolicitaDescarga>
      <des:solicitud ${attrs}/>
    </des:SolicitaDescarga>
  </s:Body>
</s:Envelope>`;
}

export function buildSolicitudRecibidosEnvelope(
  token: string,
  rfcSolicitante: string,
  params: DescargaMasivaRequest,
): string {
  let attrs = `RfcSolicitante="${escapeXml(rfcSolicitante)}"`;
  attrs += ` FechaInicio="${escapeXml(params.fechaInicio)}"`;
  attrs += ` FechaFin="${escapeXml(params.fechaFin)}"`;
  attrs += ` TipoSolicitud="${escapeXml(params.tipoSolicitud)}"`;
  if (params.tipoComprobante) attrs += ` TipoComprobante="${escapeXml(params.tipoComprobante)}"`;
  if (params.estadoComprobante) attrs += ` EstadoComprobante="${escapeXml(params.estadoComprobante)}"`;
  if (params.rfcReceptor) attrs += ` RfcReceptor="${escapeXml(params.rfcReceptor)}"`;
  if (params.complemento) attrs += ` Complemento="${escapeXml(params.complemento)}"`;
  if (params.rfcACuentaTerceros) attrs += ` RfcACuentaTerceros="${escapeXml(params.rfcACuentaTerceros)}"`;

  return `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:des="http://DescargaMasivaTerceros.sat.gob.mx" xmlns:xd="http://www.w3.org/2000/09/xmldsig#">
  <s:Header/>
  <s:Body>
    <des:SolicitaDescarga>
      <des:solicitud ${attrs}/>
    </des:SolicitaDescarga>
  </s:Body>
</s:Envelope>`;
}

export function buildVerificacionEnvelope(
  token: string,
  rfcSolicitante: string,
  requestId: string,
): string {
  return `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:des="http://DescargaMasivaTerceros.sat.gob.mx" xmlns:xd="http://www.w3.org/2000/09/xmldsig#">
  <s:Header/>
  <s:Body>
    <des:VerificaSolicitudDescarga>
      <des:solicitud RfcSolicitante="${escapeXml(rfcSolicitante)}" IdSolicitud="${escapeXml(requestId)}"/>
    </des:VerificaSolicitudDescarga>
  </s:Body>
</s:Envelope>`;
}

export function buildDescargaEnvelope(
  token: string,
  rfcSolicitante: string,
  packageId: string,
): string {
  return `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:des="http://DescargaMasivaTerceros.sat.gob.mx" xmlns:xd="http://www.w3.org/2000/09/xmldsig#">
  <s:Header/>
  <s:Body>
    <des:PeticionDescargaMasivaTercerosEntrada>
      <des:peticionDescarga RfcSolicitante="${escapeXml(rfcSolicitante)}" IdPaquete="${escapeXml(packageId)}"/>
    </des:PeticionDescargaMasivaTercerosEntrada>
  </s:Body>
</s:Envelope>`;
}

// ── Descarga Masiva Response Parsers ──

export interface DescargaMasivaAuthResponse {
  token: string;
  expiresAt: string;
  error?: string;
}

export function parseAuthResponse(soapXml: string): DescargaMasivaAuthResponse {
  const tokenMatch = soapXml.match(/<AutenticaResult>([^<]*)<\/AutenticaResult>/i);
  if (tokenMatch && tokenMatch[1]) {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    return { token: tokenMatch[1], expiresAt };
  }
  return { token: "", expiresAt: "", error: "No se pudo obtener token de autenticacion" };
}

export interface SolicitudResponse {
  requestId: string;
  codEstatus: string;
  mensaje: string;
  error?: string;
}

export function parseSolicitudResponse(soapXml: string): SolicitudResponse {
  const idMatch = soapXml.match(/IdSolicitud=["']([^"']*)["']/i) ||
                  soapXml.match(/<[^>]*IdSolicitud[^>]*>([^<]*)</i);
  const codMatch = soapXml.match(/CodEstatus=["']([^"']*)["']/i) ||
                   soapXml.match(/<[^>]*CodEstatus[^>]*>([^<]*)</i);
  const msgMatch = soapXml.match(/Mensaje=["']([^"']*)["']/i) ||
                   soapXml.match(/<[^>]*Mensaje[^>]*>([^<]*)</i);

  return {
    requestId: idMatch?.[1] || "",
    codEstatus: codMatch?.[1] || "",
    mensaje: msgMatch?.[1] || "",
    error: codMatch?.[1] && codMatch[1] !== "5000" ? msgMatch?.[1] : undefined,
  };
}

export interface VerificacionResponse {
  codEstatus: string;
  estadoSolicitud: string;
  codigoEstadoSolicitud: string;
  numeroCfdis: number;
  mensaje: string;
  packageIds: string[];
}

export function parseVerificacionResponse(soapXml: string): VerificacionResponse {
  const codMatch = soapXml.match(/CodEstatus=["']([^"']*)["']/i);
  const estadoMatch = soapXml.match(/EstadoSolicitud=["']([^"']*)["']/i);
  const codigoEstadoMatch = soapXml.match(/CodigoEstadoSolicitud=["']([^"']*)["']/i);
  const numMatch = soapXml.match(/NumeroCFDIs=["']([^"']*)["']/i);
  const msgMatch = soapXml.match(/Mensaje=["']([^"']*)["']/i);

  const packageIds: string[] = [];
  const idPaqueteRegex = /IdPaquete=["']([^"']*)["']/gi;
  let pkgMatch;
  while ((pkgMatch = idPaqueteRegex.exec(soapXml)) !== null) {
    if (pkgMatch[1]) packageIds.push(pkgMatch[1]);
  }

  return {
    codEstatus: codMatch?.[1] || "",
    estadoSolicitud: estadoMatch?.[1] || "",
    codigoEstadoSolicitud: codigoEstadoMatch?.[1] || "",
    numeroCfdis: parseInt(numMatch?.[1] || "0", 10),
    mensaje: msgMatch?.[1] || "",
    packageIds,
  };
}

// ── Descarga Masiva Polling Config ──

export interface PollingConfig {
  initialDelayMs: number;
  maxDelayMs: number;
  maxAttempts: number;
  backoffMultiplier: number;
}

export const DEFAULT_POLLING_CONFIG: PollingConfig = {
  initialDelayMs: 10_000,
  maxDelayMs: 120_000,
  maxAttempts: 20,
  backoffMultiplier: 1.5,
};

export function getPollingDelay(attempt: number, config: PollingConfig = DEFAULT_POLLING_CONFIG): number {
  const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
  return Math.min(delay, config.maxDelayMs);
}

// ── Cancellation Helpers ──

export function requiresCancellationAcceptance(
  tipoComprobante: string,
  total: number,
  rfcReceptor: string,
): boolean {
  if (["N", "E", "T"].includes(tipoComprobante)) return false;
  if (total < 1000) return false;
  if (rfcReceptor === "XAXX010101000") return false;
  return true;
}

export function validateCancellationRequest(req: CancellationRequest): { valid: boolean; error?: string } {
  if (!req.uuid) return { valid: false, error: "UUID es requerido" };
  if (!req.motivo) return { valid: false, error: "Motivo de cancelacion es requerido" };

  const motivoInfo = MOTIVOS_CANCELACION[req.motivo];
  if (!motivoInfo) return { valid: false, error: `Motivo ${req.motivo} no es valido. Usar 01, 02, 03 o 04` };

  if (motivoInfo.requiereUuidSustitucion && !req.uuidSustitucion) {
    return { valid: false, error: "Motivo 01 requiere UUID del CFDI que sustituye" };
  }

  return { valid: true };
}

// ── Utility ──

export function extractUuid(xml: string): string {
  const match = xml.match(/UUID=["']([^"']+)["']/i);
  return match?.[1] || "";
}

export function extractSelloLast8(xml: string): string {
  const match = xml.match(/Sello=["']([^"']*)["']/i);
  const sello = match?.[1] || "";
  return sello.length >= 8 ? sello.slice(-8) : sello;
}
