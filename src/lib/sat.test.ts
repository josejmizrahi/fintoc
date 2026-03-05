import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  escapeXml,
  validateCfdiAgainstSat,
  parseCfdiXml,
  testSatReachability,
  parseEfosCode,
  isEfosRisk,
  isEfosNonDeductible,
  validateRfcFormat,
  parseSatConsultaResponse,
  parseAuthResponse,
  parseSolicitudResponse,
  parseVerificacionResponse,
  getPollingDelay,
  DEFAULT_POLLING_CONFIG,
  requiresCancellationAcceptance,
  validateCancellationRequest,
  buildAuthenticationEnvelope,
  buildSolicitudEmitidosEnvelope,
  buildSolicitudRecibidosEnvelope,
  buildVerificacionEnvelope,
  buildDescargaEnvelope,
  extractUuid,
  extractSelloLast8,
  EFOS_CODES,
  MOTIVOS_CANCELACION,
} from "./sat";

// ── escapeXml ──

describe("escapeXml", () => {
  it("escapes ampersands", () => {
    expect(escapeXml("A&B")).toBe("A&amp;B");
  });

  it("escapes angle brackets", () => {
    expect(escapeXml("<tag>")).toBe("&lt;tag&gt;");
  });

  it("escapes quotes", () => {
    expect(escapeXml(`"hello" 'world'`)).toBe("&quot;hello&quot; &apos;world&apos;");
  });

  it("handles mixed special characters", () => {
    expect(escapeXml(`<a href="x&y">`)).toBe("&lt;a href=&quot;x&amp;y&quot;&gt;");
  });

  it("returns same string when no special characters", () => {
    expect(escapeXml("ABC123")).toBe("ABC123");
  });

  it("handles empty string", () => {
    expect(escapeXml("")).toBe("");
  });
});

// ── parseCfdiXml ──

describe("parseCfdiXml", () => {
  const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4.0"
  Version="4.0" Serie="A" Folio="123" Fecha="2026-01-15T10:30:00" Total="15000.50"
  SubTotal="13000.00" Descuento="500.00" TipoDeComprobante="I" MetodoPago="PUE"
  FormaPago="03" Moneda="MXN" TipoCambio="1" LugarExpedicion="06600"
  NoCertificado="30001000000500003416" Exportacion="01"
  Sello="ABCDEFGH12345678">
  <cfdi:Emisor Rfc="ABC010101AAA" Nombre="Empresa Emisora" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="XYZ020202BBB" Nombre="Empresa Receptora" UsoCFDI="G03"
    DomicilioFiscalReceptor="01000" RegimenFiscalReceptor="601"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="84111506" Cantidad="1" ClaveUnidad="E48"
      Unidad="Servicio" Descripcion="Servicio de consultoria" ValorUnitario="13000.00"
      Importe="13000.00" Descuento="500.00" ObjetoImp="02">
      <cfdi:Impuestos>
        <cfdi:Traslados>
          <cfdi:Traslado Base="12500.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="2000.00"/>
        </cfdi:Traslados>
        <cfdi:Retenciones>
          <cfdi:Retencion Base="12500.00" Impuesto="001" TipoFactor="Tasa" TasaOCuota="0.100000" Importe="1250.00"/>
        </cfdi:Retenciones>
      </cfdi:Impuestos>
    </cfdi:Concepto>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="2000.00" TotalImpuestosRetenidos="1250.00">
    <cfdi:Traslados>
      <cfdi:Traslado Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="2000.00"/>
    </cfdi:Traslados>
  </cfdi:Impuestos>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital UUID="A1B2C3D4-E5F6-7890-ABCD-EF1234567890"
      FechaTimbrado="2026-01-15T10:31:00" SelloSAT="SATSEL123" SelloCFD="CFDSEL456"
      NoCertificadoSAT="00001000000504465028" RfcProvCertif="CVD110412TF6"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;

  it("extracts UUID from XML", () => {
    const result = parseCfdiXml(sampleXml);
    expect(result.uuid).toBe("A1B2C3D4-E5F6-7890-ABCD-EF1234567890");
  });

  it("extracts RFC emisor", () => {
    const result = parseCfdiXml(sampleXml);
    expect(result.rfcEmisor).toBe("ABC010101AAA");
  });

  it("extracts RFC receptor", () => {
    const result = parseCfdiXml(sampleXml);
    expect(result.rfcReceptor).toBe("XYZ020202BBB");
  });

  it("extracts total amount", () => {
    const result = parseCfdiXml(sampleXml);
    expect(result.total).toBe(15000.5);
  });

  it("extracts fecha", () => {
    const result = parseCfdiXml(sampleXml);
    expect(result.fecha).toBe("2026-01-15T10:30:00");
  });

  it("extracts fecha timbrado", () => {
    const result = parseCfdiXml(sampleXml);
    expect(result.fechaTimbrado).toBe("2026-01-15T10:31:00");
  });

  it("extracts version", () => {
    const result = parseCfdiXml(sampleXml);
    expect(result.version).toBe("4.0");
  });

  it("extracts serie and folio", () => {
    const result = parseCfdiXml(sampleXml);
    expect(result.serie).toBe("A");
    expect(result.folio).toBe("123");
  });

  it("extracts tipo_comprobante", () => {
    const result = parseCfdiXml(sampleXml);
    expect(result.tipoComprobante).toBe("I");
  });

  it("extracts nombre_emisor", () => {
    const result = parseCfdiXml(sampleXml);
    expect(result.nombreEmisor).toBe("Empresa Emisora");
  });

  it("extracts nombre_receptor", () => {
    const result = parseCfdiXml(sampleXml);
    expect(result.nombreReceptor).toBe("Empresa Receptora");
  });

  it("extracts regimen_fiscal", () => {
    const result = parseCfdiXml(sampleXml);
    expect(result.regimenFiscal).toBe("601");
  });

  it("extracts uso_cfdi", () => {
    const result = parseCfdiXml(sampleXml);
    expect(result.usoCfdi).toBe("G03");
  });

  it("extracts subtotal and descuento", () => {
    const result = parseCfdiXml(sampleXml);
    expect(result.subtotal).toBe(13000);
    expect(result.descuento).toBe(500);
  });

  it("extracts metodo_pago and forma_pago", () => {
    const result = parseCfdiXml(sampleXml);
    expect(result.metodoPago).toBe("PUE");
    expect(result.formaPago).toBe("03");
  });

  it("extracts moneda and tipo_cambio", () => {
    const result = parseCfdiXml(sampleXml);
    expect(result.moneda).toBe("MXN");
    expect(result.tipoCambio).toBe(1);
  });

  it("extracts lugar_expedicion", () => {
    const result = parseCfdiXml(sampleXml);
    expect(result.lugarExpedicion).toBe("06600");
  });

  it("extracts receptor fiscal details", () => {
    const result = parseCfdiXml(sampleXml);
    expect(result.domicilioFiscalReceptor).toBe("01000");
    expect(result.regimenFiscalReceptor).toBe("601");
  });

  it("extracts timbre fiscal digital object", () => {
    const result = parseCfdiXml(sampleXml);
    expect(result.timbre).not.toBeNull();
    expect(result.timbre!.uuid).toBe("A1B2C3D4-E5F6-7890-ABCD-EF1234567890");
    expect(result.timbre!.selloSat).toBe("SATSEL123");
    expect(result.timbre!.noCertificadoSat).toBe("00001000000504465028");
    expect(result.timbre!.rfcProvCertif).toBe("CVD110412TF6");
  });

  it("extracts conceptos", () => {
    const result = parseCfdiXml(sampleXml);
    expect(result.conceptos).toHaveLength(1);
    const c = result.conceptos[0];
    expect(c.claveProdServ).toBe("84111506");
    expect(c.cantidad).toBe(1);
    expect(c.claveUnidad).toBe("E48");
    expect(c.descripcion).toBe("Servicio de consultoria");
    expect(c.valorUnitario).toBe(13000);
    expect(c.importe).toBe(13000);
    expect(c.descuento).toBe(500);
    expect(c.objetoImp).toBe("02");
  });

  it("extracts impuestos from conceptos", () => {
    const result = parseCfdiXml(sampleXml);
    const c = result.conceptos[0];
    expect(c.traslados).toHaveLength(1);
    expect(c.traslados[0].impuesto).toBe("002");
    expect(c.traslados[0].tasaOCuota).toBe(0.16);
    expect(c.traslados[0].importe).toBe(2000);
    expect(c.retenciones).toHaveLength(1);
    expect(c.retenciones[0].impuesto).toBe("001");
    expect(c.retenciones[0].importe).toBe(1250);
  });

  it("extracts total impuestos", () => {
    const result = parseCfdiXml(sampleXml);
    expect(result.totalImpuestosTrasladados).toBe(2000);
    expect(result.totalImpuestosRetenidos).toBe(1250);
  });

  it("returns empty values for invalid XML", () => {
    const result = parseCfdiXml("<invalid>no cfdi data</invalid>");
    expect(result.uuid).toBe("");
    expect(result.total).toBe(0);
    expect(result.rfcEmisor).toBe("");
    expect(result.conceptos).toHaveLength(0);
    expect(result.timbre).toBeNull();
    expect(result.complementoPago).toBeNull();
    expect(result.complementoNomina).toBeNull();
  });

  it("returns defaults for missing extended fields", () => {
    const xml = `<cfdi:Comprobante Total="100"><cfdi:Emisor Rfc="AAA010101AAA"/></cfdi:Comprobante>`;
    const result = parseCfdiXml(xml);
    expect(result.rfcEmisor).toBe("AAA010101AAA");
    expect(result.tipoComprobante).toBe("");
    expect(result.nombreEmisor).toBe("");
    expect(result.nombreReceptor).toBe("");
    expect(result.regimenFiscal).toBe("");
    expect(result.usoCfdi).toBe("");
    expect(result.subtotal).toBe(0);
    expect(result.descuento).toBe(0);
    expect(result.moneda).toBe("MXN"); // defaults to MXN
    expect(result.tipoCambio).toBe(1); // defaults to 1
  });

  it("handles UUID in lowercase attribute", () => {
    const xml = `<tfd:TimbreFiscalDigital uuid="lowercase-uuid-1234" />`;
    const result = parseCfdiXml(xml);
    expect(result.uuid).toBe("lowercase-uuid-1234");
  });

  it("parses complemento de pago", () => {
    const pagoXml = `<cfdi:Comprobante TipoDeComprobante="P" Total="0">
      <cfdi:Complemento>
        <pago20:Pagos>
          <pago20:Pago FechaPago="2026-01-20" FormaDePagoP="03" MonedaP="MXN" Monto="5000.00" NumOperacion="12345">
            <pago20:DoctoRelacionado IdDocumento="UUID-REL-001" Serie="A" Folio="100"
              MonedaDR="MXN" NumParcialidad="1" ImpSaldoAnt="10000.00" ImpPagado="5000.00" ImpSaldoInsoluto="5000.00"/>
          </pago20:Pago>
        </pago20:Pagos>
      </cfdi:Complemento>
    </cfdi:Comprobante>`;
    const result = parseCfdiXml(pagoXml);
    expect(result.complementoPago).not.toBeNull();
    expect(result.complementoPago!.pagos).toHaveLength(1);
    const pago = result.complementoPago!.pagos[0];
    expect(pago.fechaPago).toBe("2026-01-20");
    expect(pago.formaPago).toBe("03");
    expect(pago.monto).toBe(5000);
    expect(pago.numOperacion).toBe("12345");
    expect(pago.documentosRelacionados).toHaveLength(1);
    expect(pago.documentosRelacionados[0].idDocumento).toBe("UUID-REL-001");
    expect(pago.documentosRelacionados[0].impPagado).toBe(5000);
    expect(pago.documentosRelacionados[0].impSaldoInsoluto).toBe(5000);
  });

  it("parses complemento de nomina", () => {
    const nominaXml = `<cfdi:Comprobante TipoDeComprobante="N" Total="15000">
      <cfdi:Complemento>
        <nomina12:Nomina TipoNomina="O" FechaPago="2026-01-31" FechaInicialPago="2026-01-16"
          FechaFinalPago="2026-01-31" NumDiasPagados="15" TotalPercepciones="18000.00"
          TotalDeducciones="3000.00" TotalOtrosPagos="500.00"/>
      </cfdi:Complemento>
    </cfdi:Comprobante>`;
    const result = parseCfdiXml(nominaXml);
    expect(result.complementoNomina).not.toBeNull();
    expect(result.complementoNomina!.tipoNomina).toBe("O");
    expect(result.complementoNomina!.fechaPago).toBe("2026-01-31");
    expect(result.complementoNomina!.numDiasPagados).toBe(15);
    expect(result.complementoNomina!.totalPercepciones).toBe(18000);
    expect(result.complementoNomina!.totalDeducciones).toBe(3000);
    expect(result.complementoNomina!.totalOtrosPagos).toBe(500);
  });
});

// ── validateCfdiAgainstSat ──

describe("validateCfdiAgainstSat", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 'Vigente' when SAT responds with Vigente", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("<ConsultaResult>Estado: Vigente</ConsultaResult>"),
    }));

    const result = await validateCfdiAgainstSat("uuid-123", "RFC001", "RFC002", "1000.00");
    expect(result).toBe("Vigente");
  });

  it("returns 'Cancelado' when SAT responds with Cancelado", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("<ConsultaResult>Estado: Cancelado</ConsultaResult>"),
    }));

    const result = await validateCfdiAgainstSat("uuid-123", "RFC001", "RFC002", "1000.00");
    expect(result).toBe("Cancelado");
  });

  it("returns 'No encontrado' when SAT responds with No Encontrado", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("<ConsultaResult>No Encontrado</ConsultaResult>"),
    }));

    const result = await validateCfdiAgainstSat("uuid-123", "RFC001", "RFC002", "1000.00");
    expect(result).toBe("No encontrado");
  });

  it("returns 'Error' when SAT returns non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }));

    const result = await validateCfdiAgainstSat("uuid-123", "RFC001", "RFC002", "1000.00");
    expect(result).toBe("Error");
  });

  it("returns 'Sin verificar' on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network timeout")));

    const result = await validateCfdiAgainstSat("uuid-123", "RFC001", "RFC002", "1000.00");
    expect(result).toBe("Sin verificar");
  });

  it("returns 'Sin verificar' when response has no matching status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("<ConsultaResult>Unknown response</ConsultaResult>"),
    }));

    const result = await validateCfdiAgainstSat("uuid-123", "RFC001", "RFC002", "1000.00");
    expect(result).toBe("Sin verificar");
  });

  it("sends correct SOAP envelope with escaped XML", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("Vigente"),
    });
    vi.stubGlobal("fetch", mockFetch);

    await validateCfdiAgainstSat("my-uuid", "A&B", "C<D", "100.00");

    const body = mockFetch.mock.calls[0][1].body as string;
    expect(body).toContain("id=my-uuid");
    expect(body).toContain("tt=100.00");
    expect(body).toContain("re=A&amp;B&amp;rr=C&lt;D");
  });
});

// ── testSatReachability ──

describe("testSatReachability", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true when SAT responds ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const result = await testSatReachability("ABC010101AAA");
    expect(result).toBe(true);
  });

  it("returns true when SAT responds 500 (proves connectivity)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const result = await testSatReachability("ABC010101AAA");
    expect(result).toBe(true);
  });

  it("returns false on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    const result = await testSatReachability("ABC010101AAA");
    expect(result).toBe(false);
  });

  it("returns false when SAT responds 403", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const result = await testSatReachability("ABC010101AAA");
    expect(result).toBe(false);
  });
});

// ── parseEfosCode ──

describe("parseEfosCode", () => {
  it("returns clean for code 200", () => {
    const result = parseEfosCode("200");
    expect(result.code).toBe("200");
    expect(result.status).toBe("clean");
    expect(result.safe).toBe(true);
  });

  it("returns presumed for code 201", () => {
    const result = parseEfosCode("201");
    expect(result.code).toBe("201");
    expect(result.status).toBe("presumed");
    expect(result.safe).toBe(false);
  });

  it("returns disproved for code 202", () => {
    const result = parseEfosCode("202");
    expect(result.code).toBe("202");
    expect(result.status).toBe("disproved");
    expect(result.safe).toBe(true);
  });

  it("returns definitive for code 203", () => {
    const result = parseEfosCode("203");
    expect(result.code).toBe("203");
    expect(result.status).toBe("definitive");
    expect(result.safe).toBe(false);
  });

  it("returns favorable for code 204", () => {
    const result = parseEfosCode("204");
    expect(result.code).toBe("204");
    expect(result.status).toBe("favorable");
    expect(result.safe).toBe(true);
  });

  it("handles text-based EFOS responses", () => {
    expect(parseEfosCode("No en lista 69-B").status).toBe("clean");
    expect(parseEfosCode("Presunto art. 69-B").status).toBe("presumed");
    expect(parseEfosCode("Desvirtuado").status).toBe("disproved");
    expect(parseEfosCode("Definitivo art. 69-B").status).toBe("definitive");
    expect(parseEfosCode("Sentencia favorable").status).toBe("favorable");
  });

  it("returns unknown for empty string", () => {
    const result = parseEfosCode("");
    expect(result.status).toBe("unknown");
    expect(result.safe).toBe(true);
    expect(result.label).toBe("Sin informacion");
  });

  it("returns unknown for unrecognized text", () => {
    const result = parseEfosCode("something unexpected");
    expect(result.status).toBe("unknown");
    expect(result.safe).toBe(true);
  });
});

// ── isEfosRisk / isEfosNonDeductible ──

describe("isEfosRisk", () => {
  it("returns true for presumed", () => {
    expect(isEfosRisk("presumed")).toBe(true);
  });

  it("returns true for definitive", () => {
    expect(isEfosRisk("definitive")).toBe(true);
  });

  it("returns false for clean", () => {
    expect(isEfosRisk("clean")).toBe(false);
  });

  it("returns false for disproved", () => {
    expect(isEfosRisk("disproved")).toBe(false);
  });

  it("returns false for favorable", () => {
    expect(isEfosRisk("favorable")).toBe(false);
  });
});

describe("isEfosNonDeductible", () => {
  it("returns true only for definitive", () => {
    expect(isEfosNonDeductible("definitive")).toBe(true);
  });

  it("returns false for presumed", () => {
    expect(isEfosNonDeductible("presumed")).toBe(false);
  });

  it("returns false for clean", () => {
    expect(isEfosNonDeductible("clean")).toBe(false);
  });
});

// ── validateRfcFormat ──

describe("validateRfcFormat", () => {
  it("validates persona moral RFC (12 chars)", () => {
    const result = validateRfcFormat("ABC010101AAA");
    expect(result.valid).toBe(true);
    expect(result.type).toBe("moral");
  });

  it("validates persona fisica RFC (13 chars)", () => {
    const result = validateRfcFormat("GARC850101AB1");
    expect(result.valid).toBe(true);
    expect(result.type).toBe("fisica");
  });

  it("recognizes RFC generico", () => {
    const result = validateRfcFormat("XAXX010101000");
    expect(result.valid).toBe(true);
    expect(result.type).toBe("generico");
  });

  it("recognizes RFC extranjero", () => {
    const result = validateRfcFormat("XEXX010101000");
    expect(result.valid).toBe(true);
    expect(result.type).toBe("extranjero");
  });

  it("returns invalid for empty string", () => {
    const result = validateRfcFormat("");
    expect(result.valid).toBe(false);
    expect(result.type).toBe("invalid");
  });

  it("returns invalid for malformed RFC", () => {
    const result = validateRfcFormat("ABC");
    expect(result.valid).toBe(false);
    expect(result.type).toBe("invalid");
  });

  it("handles lowercase input", () => {
    const result = validateRfcFormat("abc010101aaa");
    expect(result.valid).toBe(true);
    expect(result.type).toBe("moral");
  });

  it("handles RFC with & and Ñ", () => {
    const result = validateRfcFormat("A&Ñ010101AAA");
    expect(result.valid).toBe(true);
    expect(result.type).toBe("moral");
  });
});

// ── parseSatConsultaResponse ──

describe("parseSatConsultaResponse", () => {
  it("parses Vigente response with EFOS", () => {
    const soapXml = `<ConsultaResponse>
      <a:CodigoEstatus>S - Comprobante obtenido satisfactoriamente</a:CodigoEstatus>
      <a:Estado>Vigente</a:Estado>
      <a:EsCancelable>Cancelable con aceptacion</a:EsCancelable>
      <a:EstatusCancelacion></a:EstatusCancelacion>
      <a:ValidacionEFOS>200</a:ValidacionEFOS>
    </ConsultaResponse>`;

    const result = parseSatConsultaResponse("uuid-test", soapXml);
    expect(result.estado).toBe("Vigente");
    expect(result.isValid).toBe(true);
    expect(result.esCancelable).toBe("Cancelable con aceptacion");
    expect(result.efosCode).toBe("200");
    expect(result.efosStatus).toBe("clean");
    expect(result.efosSafe).toBe(true);
    expect(result.hasEfosIssue).toBe(false);
  });

  it("parses Cancelado response", () => {
    const soapXml = `<ConsultaResponse>
      <a:Estado>Cancelado</a:Estado>
      <a:ValidacionEFOS>203</a:ValidacionEFOS>
    </ConsultaResponse>`;

    const result = parseSatConsultaResponse("uuid-test", soapXml);
    expect(result.estado).toBe("Cancelado");
    expect(result.isValid).toBe(false);
    expect(result.efosCode).toBe("203");
    expect(result.efosStatus).toBe("definitive");
    expect(result.hasEfosIssue).toBe(true);
  });

  it("parses No Encontrado response", () => {
    const soapXml = `<ConsultaResponse><a:Estado>No Encontrado</a:Estado></ConsultaResponse>`;
    const result = parseSatConsultaResponse("uuid-test", soapXml);
    expect(result.estado).toBe("No encontrado");
    expect(result.isValid).toBe(false);
  });
});

// ── Descarga Masiva Response Parsers ──

describe("parseAuthResponse", () => {
  it("extracts token from valid response", () => {
    const soapXml = `<AutenticaResponse><AutenticaResult>some-token-value-here</AutenticaResult></AutenticaResponse>`;
    const result = parseAuthResponse(soapXml);
    expect(result.token).toBe("some-token-value-here");
    expect(result.expiresAt).toBeTruthy();
    expect(result.error).toBeUndefined();
  });

  it("returns error when no token found", () => {
    const result = parseAuthResponse("<Response>no token</Response>");
    expect(result.token).toBe("");
    expect(result.error).toBeTruthy();
  });
});

describe("parseSolicitudResponse", () => {
  it("extracts request ID and status", () => {
    const soapXml = `<SolicitaDescargaResponse>
      <SolicitaDescargaResult IdSolicitud="REQ-12345" CodEstatus="5000" Mensaje="Solicitud Aceptada"/>
    </SolicitaDescargaResponse>`;
    const result = parseSolicitudResponse(soapXml);
    expect(result.requestId).toBe("REQ-12345");
    expect(result.codEstatus).toBe("5000");
    expect(result.mensaje).toBe("Solicitud Aceptada");
    expect(result.error).toBeUndefined();
  });

  it("returns error for non-5000 status", () => {
    const soapXml = `<SolicitaDescargaResult IdSolicitud="" CodEstatus="5004" Mensaje="Limite de solicitudes alcanzado"/>`;
    const result = parseSolicitudResponse(soapXml);
    expect(result.codEstatus).toBe("5004");
    expect(result.error).toBe("Limite de solicitudes alcanzado");
  });
});

describe("parseVerificacionResponse", () => {
  it("extracts verification with package IDs", () => {
    const soapXml = `<VerificaSolicitudDescargaResponse>
      <VerificaSolicitudDescargaResult CodEstatus="5000" EstadoSolicitud="3"
        CodigoEstadoSolicitud="5000" NumeroCFDIs="150" Mensaje="Solicitud terminada">
        <IdsPaquetes><IdPaquete="PKG-001"/><IdPaquete="PKG-002"/></IdsPaquetes>
      </VerificaSolicitudDescargaResult>
    </VerificaSolicitudDescargaResponse>`;
    const result = parseVerificacionResponse(soapXml);
    expect(result.codEstatus).toBe("5000");
    expect(result.estadoSolicitud).toBe("3");
    expect(result.numeroCfdis).toBe(150);
    expect(result.packageIds).toEqual(["PKG-001", "PKG-002"]);
  });

  it("handles empty response", () => {
    const result = parseVerificacionResponse("<empty/>");
    expect(result.codEstatus).toBe("");
    expect(result.numeroCfdis).toBe(0);
    expect(result.packageIds).toEqual([]);
  });
});

// ── Polling Config ──

describe("getPollingDelay", () => {
  it("returns initial delay for attempt 0", () => {
    const delay = getPollingDelay(0);
    expect(delay).toBe(DEFAULT_POLLING_CONFIG.initialDelayMs);
  });

  it("increases delay with each attempt", () => {
    const delay0 = getPollingDelay(0);
    const delay1 = getPollingDelay(1);
    const delay2 = getPollingDelay(2);
    expect(delay1).toBeGreaterThan(delay0);
    expect(delay2).toBeGreaterThan(delay1);
  });

  it("caps delay at maxDelayMs", () => {
    const delay = getPollingDelay(100);
    expect(delay).toBe(DEFAULT_POLLING_CONFIG.maxDelayMs);
  });
});

// ── Cancellation Helpers ──

describe("requiresCancellationAcceptance", () => {
  it("returns true for Ingreso >= 1000 with normal RFC", () => {
    expect(requiresCancellationAcceptance("I", 5000, "ABC010101AAA")).toBe(true);
  });

  it("returns false for Nomina type", () => {
    expect(requiresCancellationAcceptance("N", 50000, "ABC010101AAA")).toBe(false);
  });

  it("returns false for Egreso type", () => {
    expect(requiresCancellationAcceptance("E", 50000, "ABC010101AAA")).toBe(false);
  });

  it("returns false for Traslado type", () => {
    expect(requiresCancellationAcceptance("T", 50000, "ABC010101AAA")).toBe(false);
  });

  it("returns false for total < 1000", () => {
    expect(requiresCancellationAcceptance("I", 999, "ABC010101AAA")).toBe(false);
  });

  it("returns false for RFC generico", () => {
    expect(requiresCancellationAcceptance("I", 50000, "XAXX010101000")).toBe(false);
  });
});

describe("validateCancellationRequest", () => {
  it("accepts valid request with motivo 02", () => {
    const result = validateCancellationRequest({ uuid: "test-uuid", motivo: "02" });
    expect(result.valid).toBe(true);
  });

  it("rejects missing UUID", () => {
    const result = validateCancellationRequest({ uuid: "", motivo: "02" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("UUID");
  });

  it("rejects missing motivo", () => {
    const result = validateCancellationRequest({ uuid: "test", motivo: "" as any });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Motivo");
  });

  it("rejects invalid motivo", () => {
    const result = validateCancellationRequest({ uuid: "test", motivo: "05" as any });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("no es valido");
  });

  it("rejects motivo 01 without uuid sustitucion", () => {
    const result = validateCancellationRequest({ uuid: "test", motivo: "01" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("sustituye");
  });

  it("accepts motivo 01 with uuid sustitucion", () => {
    const result = validateCancellationRequest({ uuid: "test", motivo: "01", uuidSustitucion: "new-uuid" });
    expect(result.valid).toBe(true);
  });
});

// ── SOAP Envelope Builders ──

describe("buildAuthenticationEnvelope", () => {
  it("contains cert and timestamps", () => {
    const env = buildAuthenticationEnvelope("CERT123", { created: "2026-01-01T00:00:00Z", expires: "2026-01-01T00:05:00Z" });
    expect(env).toContain("CERT123");
    expect(env).toContain("2026-01-01T00:00:00Z");
    expect(env).toContain("2026-01-01T00:05:00Z");
    expect(env).toContain("Autentica");
  });
});

describe("buildSolicitudEmitidosEnvelope", () => {
  it("contains request parameters", () => {
    const env = buildSolicitudEmitidosEnvelope("token", "ABC010101AAA", {
      fechaInicio: "2026-01-01",
      fechaFin: "2026-01-31",
      tipoSolicitud: "CFDI",
      tipoComprobante: "I",
    });
    expect(env).toContain('RfcSolicitante="ABC010101AAA"');
    expect(env).toContain('FechaInicio="2026-01-01"');
    expect(env).toContain('FechaFin="2026-01-31"');
    expect(env).toContain('TipoSolicitud="CFDI"');
    expect(env).toContain('TipoComprobante="I"');
    expect(env).toContain("SolicitaDescarga");
  });
});

describe("buildSolicitudRecibidosEnvelope", () => {
  it("contains request parameters", () => {
    const env = buildSolicitudRecibidosEnvelope("token", "ABC010101AAA", {
      fechaInicio: "2026-01-01",
      fechaFin: "2026-01-31",
      tipoSolicitud: "Metadata",
    });
    expect(env).toContain('RfcSolicitante="ABC010101AAA"');
    expect(env).toContain('TipoSolicitud="Metadata"');
    expect(env).toContain("SolicitaDescarga");
  });
});

describe("buildVerificacionEnvelope", () => {
  it("contains request ID and RFC", () => {
    const env = buildVerificacionEnvelope("token", "ABC010101AAA", "REQ-123");
    expect(env).toContain('RfcSolicitante="ABC010101AAA"');
    expect(env).toContain('IdSolicitud="REQ-123"');
    expect(env).toContain("VerificaSolicitudDescarga");
  });
});

describe("buildDescargaEnvelope", () => {
  it("contains package ID and RFC", () => {
    const env = buildDescargaEnvelope("token", "ABC010101AAA", "PKG-456");
    expect(env).toContain('RfcSolicitante="ABC010101AAA"');
    expect(env).toContain('IdPaquete="PKG-456"');
    expect(env).toContain("PeticionDescargaMasivaTercerosEntrada");
  });
});

// ── Utility Functions ──

describe("extractUuid", () => {
  it("extracts UUID from XML", () => {
    expect(extractUuid('<tfd:TimbreFiscalDigital UUID="ABC-123-DEF"/>')).toBe("ABC-123-DEF");
  });

  it("returns empty for no UUID", () => {
    expect(extractUuid("<no-uuid/>")).toBe("");
  });
});

describe("extractSelloLast8", () => {
  it("extracts last 8 chars of sello", () => {
    expect(extractSelloLast8('Sello="ABCDEFGHIJKLMNOP"')).toBe("IJKLMNOP");
  });

  it("returns full sello if less than 8 chars", () => {
    expect(extractSelloLast8('Sello="ABC"')).toBe("ABC");
  });

  it("returns empty for no sello", () => {
    expect(extractSelloLast8("<no-sello/>")).toBe("");
  });
});

// ── Constants ──

describe("EFOS_CODES", () => {
  it("has entries for 200-204", () => {
    expect(Object.keys(EFOS_CODES)).toEqual(["200", "201", "202", "203", "204"]);
  });
});

describe("MOTIVOS_CANCELACION", () => {
  it("has entries for 01-04", () => {
    expect(Object.keys(MOTIVOS_CANCELACION)).toEqual(["01", "02", "03", "04"]);
  });

  it("only motivo 01 requires UUID sustitucion", () => {
    expect(MOTIVOS_CANCELACION["01"].requiereUuidSustitucion).toBe(true);
    expect(MOTIVOS_CANCELACION["02"].requiereUuidSustitucion).toBe(false);
    expect(MOTIVOS_CANCELACION["03"].requiereUuidSustitucion).toBe(false);
    expect(MOTIVOS_CANCELACION["04"].requiereUuidSustitucion).toBe(false);
  });
});
