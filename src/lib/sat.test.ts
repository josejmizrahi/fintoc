import { describe, it, expect, vi, beforeEach } from "vitest";
import { escapeXml, validateCfdiAgainstSat, parseCfdiXml, testSatReachability } from "./sat";

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
  Fecha="2026-01-15T10:30:00" Total="15000.50" SubTotal="13000.00" Descuento="500.00" TipoDeComprobante="I">
  <cfdi:Emisor Rfc="ABC010101AAA" Nombre="Empresa Emisora" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="XYZ020202BBB" Nombre="Empresa Receptora" UsoCFDI="G03"/>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital UUID="A1B2C3D4-E5F6-7890-ABCD-EF1234567890"
      FechaTimbrado="2026-01-15T10:31:00"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;

  it("extracts UUID from XML", () => {
    const result = parseCfdiXml(sampleXml);
    expect(result.uuid).toBe("A1B2C3D4-E5F6-7890-ABCD-EF1234567890");
  });

  it("extracts RFC emisor (first RFC)", () => {
    const result = parseCfdiXml(sampleXml);
    expect(result.rfcEmisor).toBe("ABC010101AAA");
  });

  it("extracts RFC receptor (second RFC)", () => {
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

  it("returns empty values for invalid XML", () => {
    const result = parseCfdiXml("<invalid>no cfdi data</invalid>");
    expect(result.uuid).toBe("");
    expect(result.total).toBe(0);
    expect(result.rfcEmisor).toBe("");
  });

  it("handles XML with single RFC (emisor only)", () => {
    const xml = `<cfdi:Comprobante Total="100"><cfdi:Emisor Rfc="AAA010101AAA"/></cfdi:Comprobante>`;
    const result = parseCfdiXml(xml);
    expect(result.rfcEmisor).toBe("AAA010101AAA");
    // Falls back to first RFC when no second RFC
    expect(result.rfcReceptor).toBe("AAA010101AAA");
  });

  it("handles UUID in lowercase attribute", () => {
    const xml = `<tfd:TimbreFiscalDigital uuid="lowercase-uuid-1234" />`;
    const result = parseCfdiXml(xml);
    expect(result.uuid).toBe("lowercase-uuid-1234");
  });

  // New tests for extended XML parser (#11)
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

  it("returns empty strings for missing extended fields", () => {
    const xml = `<cfdi:Comprobante Total="100"><cfdi:Emisor Rfc="AAA010101AAA"/></cfdi:Comprobante>`;
    const result = parseCfdiXml(xml);
    expect(result.tipoComprobante).toBe("");
    expect(result.nombreEmisor).toBe("");
    expect(result.nombreReceptor).toBe("");
    expect(result.regimenFiscal).toBe("");
    expect(result.usoCfdi).toBe("");
    expect(result.subtotal).toBe(0);
    expect(result.descuento).toBe(0);
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
    // escapeXml runs first, then the &amp; in the template literal joins them
    expect(body).toContain("id=my-uuid");
    expect(body).toContain("tt=100.00");
    // escapeXml("A&B") = "A&amp;B", then &amp; separator between re= and rr=
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
