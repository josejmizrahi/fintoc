/**
 * SAT CFDI Validation Utilities
 * Shared by: catch-all route, onboarding route, reconciliation route
 */

const SAT_SOAP_URL = "https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc";
const SAT_SOAP_ACTION = "http://tempuri.org/IConsultaCFDIService/Consulta";

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

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
  } catch {
    return "Sin verificar";
  }
}

export interface ParsedCfdi {
  uuid: string;
  rfcEmisor: string;
  rfcReceptor: string;
  total: number;
  fecha: string;
  fechaTimbrado: string;
  tipoComprobante: string;
  nombreEmisor: string;
  nombreReceptor: string;
  regimenFiscal: string;
  usoCfdi: string;
  subtotal: number;
  descuento: number;
}

export function parseCfdiXml(xml: string): ParsedCfdi {
  const uuidMatch =
    xml.match(/UUID=["']([^"']+)["']/i) ||
    xml.match(/uuid=["']([^"']+)["']/i);
  const rfcEmisorMatch = xml.match(
    /Rfc=["']([A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3})["']/i,
  );
  const rfcMatches =
    xml.match(/Rfc=["']([A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3})["']/gi) || [];
  const allRfcs = rfcMatches
    .map((m) => {
      const r = m.match(/["']([^"']+)["']/);
      return r ? r[1] : "";
    })
    .filter(Boolean);
  const totalMatch = xml.match(/Total=["']([^"']+)["']/i);
  const fechaMatch = xml.match(/Fecha=["']([^"']+)["']/i);
  const fechaTimbradoMatch = xml.match(/FechaTimbrado=["']([^"']+)["']/i);

  // Fix #11: Extract additional CFDI fields
  const tipoMatch = xml.match(/TipoDeComprobante=["']([^"']+)["']/i);
  const subtotalMatch = xml.match(/SubTotal=["']([^"']+)["']/i);
  const descuentoMatch = xml.match(/Descuento=["']([^"']+)["']/i);

  // Extract Emisor/Receptor names (Nombre attribute within their respective elements)
  const emisorBlock = xml.match(/<[^>]*Emisor[^>]*>/i)?.[0] || "";
  const receptorBlock = xml.match(/<[^>]*Receptor[^>]*>/i)?.[0] || "";
  const nombreEmisor = emisorBlock.match(/Nombre=["']([^"']+)["']/i)?.[1] || "";
  const nombreReceptor = receptorBlock.match(/Nombre=["']([^"']+)["']/i)?.[1] || "";
  const regimenFiscal = emisorBlock.match(/RegimenFiscal=["']([^"']+)["']/i)?.[1] || "";
  const usoCfdi = receptorBlock.match(/UsoCFDI=["']([^"']+)["']/i)?.[1] || "";

  return {
    uuid: uuidMatch?.[1] || "",
    rfcEmisor: allRfcs[0] || rfcEmisorMatch?.[1] || "",
    rfcReceptor: allRfcs[1] || allRfcs[0] || "",
    total: parseFloat(totalMatch?.[1] || "0") || 0,
    fecha: fechaMatch?.[1] || "",
    fechaTimbrado: fechaTimbradoMatch?.[1] || "",
    tipoComprobante: tipoMatch?.[1] || "",
    nombreEmisor,
    nombreReceptor,
    regimenFiscal,
    usoCfdi,
    subtotal: parseFloat(subtotalMatch?.[1] || "0") || 0,
    descuento: parseFloat(descuentoMatch?.[1] || "0") || 0,
  };
}

/** Test SAT service reachability with a dummy validation */
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

    return res.ok || res.status === 500; // 500 for invalid UUIDs proves connectivity
  } catch {
    return false;
  }
}
