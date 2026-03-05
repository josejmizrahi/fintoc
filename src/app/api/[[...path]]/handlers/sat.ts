/**
 * SAT handlers — Complete implementation
 * Includes: validation, EFOS risk, RFC validation, descarga masiva, cancellation
 */

import { query, insert, update } from "@/lib/db";
import {
  validateCfdiAgainstSat,
  validateCfdiFullResponse,
  parseCfdiXml,
  validateRfcFormat,
  requiresCancellationAcceptance,
  validateCancellationRequest,
  TIPO_COMPROBANTE,
  type SatValidationResult,
} from "@/lib/sat";
import { NextResponse } from "next/server";

export async function handleSatGet(path: string, companyId: number): Promise<unknown | null> {
  if (path === "sat/documents") {
    const { data } = await query("cfdi_documents", { match: { company_id: companyId }, order: { column: "fecha_emision" } });
    return data || [];
  }

  if (path === "sat/efos-risk") {
    return getEfosRiskDashboard(companyId);
  }

  if (path === "sat/descarga/requests") {
    const { data } = await query("sat_download_requests", { match: { company_id: companyId }, order: { column: "created_at" } });
    return data || [];
  }

  if (path === "sat/cancelaciones") {
    const { data } = await query("sat_cancellation_requests", { match: { company_id: companyId }, order: { column: "created_at" } });
    return data || [];
  }

  return null;
}

export async function handleSatPost(path: string, body: Record<string, unknown>, companyId: number): Promise<Response | unknown | null> {
  // ── Single CFDI Validation (simple) ──
  if (path === "sat/validate") {
    const uuid = (body.uuid as string) || "";
    const rfcEmisor = (body.rfc_emisor as string) || "";
    const rfcReceptor = (body.rfc_receptor as string) || "";
    const total = String(Number(body.total) || 0);
    if (!uuid || !rfcEmisor || !rfcReceptor) {
      return NextResponse.json({ detail: "Faltan campos: uuid, rfc_emisor, rfc_receptor, total" }, { status: 400 });
    }
    const estado = await validateCfdiAgainstSat(uuid, rfcEmisor, rfcReceptor, total);
    return { uuid, estado, rfc_emisor: rfcEmisor, rfc_receptor: rfcReceptor, consulta_date: new Date().toISOString() };
  }

  // ── Full CFDI Validation (with EFOS) ──
  if (path === "sat/validate/full") {
    const uuid = (body.uuid as string) || "";
    const rfcEmisor = (body.rfc_emisor as string) || "";
    const rfcReceptor = (body.rfc_receptor as string) || "";
    const total = String(Number(body.total) || 0);
    if (!uuid || !rfcEmisor || !rfcReceptor) {
      return NextResponse.json({ detail: "Faltan campos: uuid, rfc_emisor, rfc_receptor, total" }, { status: 400 });
    }
    const result = await validateCfdiFullResponse(uuid, rfcEmisor, rfcReceptor, total);
    await updateSatStatus(companyId, uuid, result);
    return result;
  }

  // ── Bulk Validation ──
  if (path === "sat/validate/bulk") {
    const uuids = (body.uuids as string[]) || [];
    if (!Array.isArray(uuids) || uuids.length === 0) {
      return NextResponse.json({ detail: "Envia un arreglo de UUIDs" }, { status: 400 });
    }
    const { data: satInt } = await query("integrations", { match: { company_id: companyId, provider: "sat" }, single: true });
    const companyRfc = (satInt?.config as Record<string, string>)?.rfcEmisor || "";
    const results: Array<{ uuid: string; estado: string; efos_status?: string }> = [];
    for (const uuid of uuids.slice(0, 100)) {
      try {
        const { data: inv } = await query("invoices", { match: { company_id: companyId, cfdi_uuid: uuid }, single: true });
        const total = inv ? String(Number(inv.amount_total) || 0) : "0";
        const isReceivable = inv?.type === "receivable";
        const partnerRfc = (inv?.partner_rfc as string) || companyRfc;
        const satRfcEmisor = isReceivable ? companyRfc : partnerRfc;
        const satRfcReceptor = isReceivable ? partnerRfc : companyRfc;
        const fullResult = await validateCfdiFullResponse(uuid, satRfcEmisor, satRfcReceptor, total);
        results.push({ uuid, estado: fullResult.estado, efos_status: fullResult.efosStatus });
        if (inv) {
          await update("invoices", {
            sat_status: fullResult.estado,
            sat_validated: true,
            efos_status: fullResult.efosStatus,
            es_cancelable: fullResult.esCancelable,
            sat_last_check: new Date().toISOString(),
          }, { id: inv.id });
        }
      } catch {
        results.push({ uuid, estado: "Error" });
      }
    }
    return { validated: results.length, results };
  }

  // ── Upload XML ──
  if (path === "sat/upload-xml") {
    const xmlContent = (body.xml_content as string) || "";
    if (!xmlContent.trim()) {
      return NextResponse.json({ detail: "Falta el contenido XML" }, { status: 400 });
    }
    return handleUploadXml(xmlContent, companyId);
  }

  // ── Revalidate All ──
  if (path === "sat/revalidate-all") {
    return handleRevalidateAll(companyId);
  }

  // ── RFC Validation ──
  if (path === "sat/validate-rfc") {
    const rfc = (body.rfc as string) || "";
    if (!rfc) return NextResponse.json({ detail: "RFC es requerido" }, { status: 400 });
    return handleValidateRfc(rfc, body.entity_type as string, body.entity_id as number | undefined, companyId);
  }

  if (path === "sat/validate-rfc/bulk") {
    const rfcs = (body.rfcs as string[]) || [];
    if (!Array.isArray(rfcs) || rfcs.length === 0) {
      return NextResponse.json({ detail: "Envia un arreglo de RFCs" }, { status: 400 });
    }
    return handleValidateRfcBulk(rfcs, body.entity_type as string, companyId);
  }

  // ── Descarga Masiva ──
  if (path === "sat/descarga/solicitud") {
    return handleDescargaSolicitud(body, companyId);
  }

  if (path === "sat/descarga/verificar") {
    return handleDescargaVerificar(body, companyId);
  }

  if (path === "sat/descarga/descargar") {
    return handleDescargaDescargar(body, companyId);
  }

  // ── Cancellation ──
  if (path === "sat/cancelar") {
    return handleCancelar(body, companyId);
  }

  if (path === "sat/cancelacion/aceptar") {
    return handleCancelacionAccion(body, companyId, "accepted");
  }

  if (path === "sat/cancelacion/rechazar") {
    return handleCancelacionAccion(body, companyId, "rejected");
  }

  return null;
}

// ── Upload XML Handler (enhanced) ──

async function handleUploadXml(xmlContent: string, companyId: number) {
  const parsed = parseCfdiXml(xmlContent);
  if (!parsed.uuid) {
    return NextResponse.json({ detail: "No se encontro UUID en el XML" }, { status: 400 });
  }

  const { data: existing } = await query("cfdi_documents", { match: { company_id: companyId, uuid: parsed.uuid }, single: true });
  if (existing) {
    return { id: existing.id, uuid: parsed.uuid, status: "already_exists", rfc_emisor: parsed.rfcEmisor, total: parsed.total };
  }

  const satResult = await validateCfdiFullResponse(parsed.uuid, parsed.rfcEmisor, parsed.rfcReceptor, String(parsed.total));

  const { data: linkedInvoice } = await query("invoices", { match: { company_id: companyId, cfdi_uuid: parsed.uuid }, single: true }).catch(() => ({ data: null }));

  const { data: inserted } = await insert("cfdi_documents", {
    company_id: companyId,
    uuid: parsed.uuid,
    rfc_emisor: parsed.rfcEmisor,
    rfc_receptor: parsed.rfcReceptor,
    nombre_emisor: parsed.nombreEmisor || null,
    nombre_receptor: parsed.nombreReceptor || null,
    tipo_comprobante: parsed.tipoComprobante || null,
    total: parsed.total,
    subtotal: parsed.subtotal,
    moneda: parsed.moneda,
    tipo_cambio: parsed.tipoCambio,
    forma_pago: parsed.formaPago || null,
    metodo_pago: parsed.metodoPago || null,
    uso_cfdi: parsed.usoCfdi || null,
    lugar_expedicion: parsed.lugarExpedicion || null,
    descuento: parsed.descuento,
    emisor_regimen: parsed.regimenFiscal || null,
    receptor_regimen: parsed.regimenFiscalReceptor || null,
    receptor_domicilio_fiscal: parsed.domicilioFiscalReceptor || null,
    exportacion: parsed.exportacion || null,
    fecha_emision: parsed.fecha || null,
    fecha_timbrado: parsed.fechaTimbrado || null,
    sello_sat: parsed.timbre?.selloSat || null,
    sello_cfd: parsed.sello || null,
    no_certificado_sat: parsed.timbre?.noCertificadoSat || null,
    no_certificado_emisor: parsed.noCertificado || null,
    sat_status: satResult.estado,
    is_cancelable: satResult.esCancelable || null,
    cancellation_status: satResult.estatusCancelacion || null,
    efos_status: satResult.efosStatus,
    sat_last_check: new Date().toISOString(),
    conceptos: parsed.conceptos.length > 0 ? JSON.stringify(parsed.conceptos) : null,
    impuestos_trasladados: parsed.totalImpuestosTrasladados,
    impuestos_retenidos: parsed.totalImpuestosRetenidos,
    complemento_pago: parsed.complementoPago ? JSON.stringify(parsed.complementoPago) : null,
    complemento_nomina: parsed.complementoNomina ? JSON.stringify(parsed.complementoNomina) : null,
    xml_content: xmlContent,
    invoice_id: linkedInvoice ? (linkedInvoice as Record<string, unknown>).id : null,
  });
  const doc = inserted?.[0];

  if (linkedInvoice) {
    await update("invoices", {
      sat_status: satResult.estado,
      sat_validated: true,
      tipo_comprobante: parsed.tipoComprobante || null,
      metodo_pago: parsed.metodoPago || null,
      forma_pago: parsed.formaPago || null,
      moneda: parsed.moneda,
      tipo_cambio: parsed.tipoCambio,
      uso_cfdi: parsed.usoCfdi || null,
      emisor_nombre: parsed.nombreEmisor || null,
      receptor_nombre: parsed.nombreReceptor || null,
      emisor_regimen: parsed.regimenFiscal || null,
      receptor_regimen: parsed.regimenFiscalReceptor || null,
      es_cancelable: satResult.esCancelable || null,
      efos_status: satResult.efosStatus,
      sat_last_check: new Date().toISOString(),
    }, { id: (linkedInvoice as Record<string, unknown>).id });
  } else {
    const { data: satInt } = await query("integrations", { match: { company_id: companyId, provider: "sat" }, single: true }).catch(() => ({ data: null }));
    const companyRfc = (satInt?.config as Record<string, string>)?.rfcEmisor || "";
    const isEmitted = parsed.rfcEmisor === companyRfc;
    const newInvoice = await insert("invoices", {
      company_id: companyId,
      name: `${parsed.serie || ""}${parsed.folio || parsed.uuid}`,
      type: isEmitted ? "receivable" : "payable",
      partner_name: isEmitted ? parsed.nombreReceptor : parsed.nombreEmisor,
      partner_rfc: isEmitted ? parsed.rfcReceptor : parsed.rfcEmisor,
      amount_total: parsed.total,
      amount_residual: parsed.total,
      date_invoice: parsed.fecha || null,
      status: "open",
      cfdi_uuid: parsed.uuid,
      sat_status: satResult.estado,
      sat_validated: true,
      tipo_comprobante: parsed.tipoComprobante || null,
      metodo_pago: parsed.metodoPago || null,
      forma_pago: parsed.formaPago || null,
      moneda: parsed.moneda,
      uso_cfdi: parsed.usoCfdi || null,
      emisor_nombre: parsed.nombreEmisor || null,
      receptor_nombre: parsed.nombreReceptor || null,
      emisor_regimen: parsed.regimenFiscal || null,
      efos_status: satResult.efosStatus,
      descuento: parsed.descuento,
      lugar_expedicion: parsed.lugarExpedicion || null,
      sat_last_check: new Date().toISOString(),
      source: "sat_upload",
    });
    if (newInvoice.data?.[0]?.id && doc?.id) {
      await update("cfdi_documents", { invoice_id: newInvoice.data[0].id }, { id: doc.id });
    }
  }

  return {
    id: doc?.id,
    uuid: parsed.uuid,
    rfc_emisor: parsed.rfcEmisor,
    rfc_receptor: parsed.rfcReceptor,
    total: parsed.total,
    tipo_comprobante: parsed.tipoComprobante,
    tipo_comprobante_label: TIPO_COMPROBANTE[parsed.tipoComprobante] || parsed.tipoComprobante,
    metodo_pago: parsed.metodoPago,
    forma_pago: parsed.formaPago,
    moneda: parsed.moneda,
    estado: satResult.estado,
    efos_status: satResult.efosStatus,
    efos_safe: satResult.efosSafe,
    es_cancelable: satResult.esCancelable,
    conceptos_count: parsed.conceptos.length,
    has_complemento_pago: !!parsed.complementoPago,
    status: "processed",
    invoice_linked: !!linkedInvoice,
  };
}

// ── Revalidate All ──

async function handleRevalidateAll(companyId: number) {
  const { data: docs } = await query("cfdi_documents", { match: { company_id: companyId } });
  const { data: satInt } = await query("integrations", { match: { company_id: companyId, provider: "sat" }, single: true });
  const companyRfc = (satInt?.config as Record<string, string>)?.rfcEmisor || "";
  let revalidated = 0, vigentes = 0, cancelados = 0, errores = 0, efos_issues = 0;

  for (const doc of (docs || []).slice(0, 500)) {
    try {
      const uuid = doc.uuid as string;
      if (!uuid) continue;
      const result = await validateCfdiFullResponse(
        uuid,
        (doc.rfc_emisor as string) || companyRfc,
        (doc.rfc_receptor as string) || companyRfc,
        String(Number(doc.total) || 0),
      );
      await update("cfdi_documents", {
        sat_status: result.estado,
        efos_status: result.efosStatus,
        is_cancelable: result.esCancelable || null,
        cancellation_status: result.estatusCancelacion || null,
        sat_last_check: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { id: doc.id });
      revalidated++;
      if (result.estado === "Vigente") vigentes++;
      else if (result.estado === "Cancelado") cancelados++;
      if (result.hasEfosIssue) efos_issues++;
    } catch { errores++; }
  }

  const { data: invoices } = await query("invoices", { match: { company_id: companyId } });
  for (const inv of (invoices || []).filter((i: Record<string, unknown>) => i.cfdi_uuid)) {
    try {
      const isReceivable = inv.type === "receivable";
      const partnerRfc = (inv.partner_rfc as string) || companyRfc;
      const satRfcEmisor = isReceivable ? companyRfc : partnerRfc;
      const satRfcReceptor = isReceivable ? partnerRfc : companyRfc;
      const result = await validateCfdiFullResponse(
        inv.cfdi_uuid as string,
        satRfcEmisor,
        satRfcReceptor,
        String(Number(inv.amount_total) || 0),
      );
      await update("invoices", {
        sat_status: result.estado,
        sat_validated: true,
        efos_status: result.efosStatus,
        es_cancelable: result.esCancelable || null,
        sat_last_check: new Date().toISOString(),
      }, { id: inv.id });
      revalidated++;
      if (result.estado === "Vigente") vigentes++;
      else if (result.estado === "Cancelado") cancelados++;
      if (result.hasEfosIssue) efos_issues++;
    } catch { errores++; }
  }

  return { revalidated, vigentes, cancelados, errores, efos_issues };
}

// ── EFOS Risk Dashboard ──

async function getEfosRiskDashboard(companyId: number) {
  const { data: vendors } = await query("vendors", { match: { company_id: companyId } });
  const riskyVendors = (vendors || []).filter((v: Record<string, unknown>) =>
    v.efos_status === "presumed" || v.efos_status === "definitive"
  );

  const { data: invoices } = await query("invoices", { match: { company_id: companyId } });
  const riskyInvoices = (invoices || []).filter((i: Record<string, unknown>) =>
    i.efos_status === "presumed" || i.efos_status === "definitive"
  );

  const definitiveTotal = riskyInvoices
    .filter((i: Record<string, unknown>) => i.efos_status === "definitive")
    .reduce((sum: number, i: Record<string, unknown>) => sum + (Number(i.amount_total) || 0), 0);
  const presumedTotal = riskyInvoices
    .filter((i: Record<string, unknown>) => i.efos_status === "presumed")
    .reduce((sum: number, i: Record<string, unknown>) => sum + (Number(i.amount_total) || 0), 0);

  return {
    vendors_at_risk: riskyVendors.length,
    vendors_definitive: riskyVendors.filter((v: Record<string, unknown>) => v.efos_status === "definitive").length,
    vendors_presumed: riskyVendors.filter((v: Record<string, unknown>) => v.efos_status === "presumed").length,
    invoices_at_risk: riskyInvoices.length,
    non_deductible_amount: definitiveTotal,
    at_risk_amount: presumedTotal,
    risky_vendors: riskyVendors.map((v: Record<string, unknown>) => ({
      id: v.id, name: v.name, rfc: v.rfc, efos_status: v.efos_status, efos_checked_at: v.efos_checked_at,
    })),
    risky_invoices: riskyInvoices.slice(0, 50).map((i: Record<string, unknown>) => ({
      id: i.id, cfdi_uuid: i.cfdi_uuid, partner_name: i.partner_name, partner_rfc: i.partner_rfc,
      amount_total: i.amount_total, efos_status: i.efos_status, type: i.type,
    })),
  };
}

// ── Update SAT status in DB ──

async function updateSatStatus(companyId: number, uuid: string, result: SatValidationResult) {
  const { data: doc } = await query("cfdi_documents", { match: { company_id: companyId, uuid }, single: true }).catch(() => ({ data: null }));
  if (doc) {
    await update("cfdi_documents", {
      sat_status: result.estado, efos_status: result.efosStatus,
      is_cancelable: result.esCancelable || null, cancellation_status: result.estatusCancelacion || null,
      sat_last_check: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, { id: doc.id });
  }

  const { data: inv } = await query("invoices", { match: { company_id: companyId, cfdi_uuid: uuid }, single: true }).catch(() => ({ data: null }));
  if (inv) {
    await update("invoices", {
      sat_status: result.estado, sat_validated: true, efos_status: result.efosStatus,
      es_cancelable: result.esCancelable || null, sat_last_check: new Date().toISOString(),
    }, { id: inv.id });
  }
}

// ── RFC Validation ──

async function handleValidateRfc(rfc: string, entityType?: string, entityId?: number, companyId?: number) {
  const formatResult = validateRfcFormat(rfc);

  if (companyId) {
    await insert("rfc_validations", {
      company_id: companyId, rfc: rfc.toUpperCase(), entity_type: entityType || "unknown",
      entity_id: entityId || null, is_valid: formatResult.valid,
      rfc_status: formatResult.valid ? "formato_valido" : "formato_invalido",
      validated_at: new Date().toISOString(),
    }).catch(() => {});

    if (formatResult.valid && entityType === "vendor" && entityId) {
      await update("vendors", { rfc_validated: true, rfc_validated_at: new Date().toISOString() }, { id: entityId }).catch(() => {});
    }
    if (formatResult.valid && entityType === "customer" && entityId) {
      await update("customers", { rfc_validated: true, rfc_validated_at: new Date().toISOString() }, { id: entityId }).catch(() => {});
    }
  }

  return { rfc: rfc.toUpperCase(), valid: formatResult.valid, type: formatResult.type, validated_at: new Date().toISOString() };
}

async function handleValidateRfcBulk(rfcs: string[], entityType?: string, companyId?: number) {
  const results = rfcs.slice(0, 5000).map(rfc => {
    const result = validateRfcFormat(rfc);
    return { rfc: rfc.toUpperCase(), valid: result.valid, type: result.type };
  });

  if (companyId && results.length > 0) {
    const validations = results.map(r => ({
      company_id: companyId, rfc: r.rfc, entity_type: entityType || "unknown",
      is_valid: r.valid, rfc_status: r.valid ? "formato_valido" : "formato_invalido",
      validated_at: new Date().toISOString(),
    }));
    await insert("rfc_validations", validations).catch(() => {});
  }

  return {
    total: results.length,
    valid: results.filter(r => r.valid).length,
    invalid: results.filter(r => !r.valid).length,
    results,
  };
}

// ── Descarga Masiva ──

async function handleDescargaSolicitud(body: Record<string, unknown>, companyId: number) {
  const requestType = (body.request_type as string) || "recibidos";
  const solicitudType = (body.solicitud_type as string) || "CFDI";
  const fechaInicio = (body.fecha_inicio as string) || "";
  const fechaFin = (body.fecha_fin as string) || "";

  if (!fechaInicio || !fechaFin) {
    return NextResponse.json({ detail: "fecha_inicio y fecha_fin son requeridos" }, { status: 400 });
  }

  const { data: req } = await insert("sat_download_requests", {
    company_id: companyId, request_type: requestType, solicitud_type: solicitudType,
    fecha_inicio: fechaInicio, fecha_fin: fechaFin,
    rfc_emisor: (body.rfc_emisor as string) || null,
    rfc_receptor: (body.rfc_receptor as string) || null,
    tipo_comprobante: (body.tipo_comprobante as string) || null,
    estado_comprobante: (body.estado_comprobante as string) || null,
    complemento: (body.complemento as string) || null,
    status: "pending",
  });

  return {
    id: req?.[0]?.id, status: "pending",
    message: "Solicitud de descarga creada. Se requiere autenticacion FIEL para enviar al SAT.",
    request_type: requestType, solicitud_type: solicitudType,
    fecha_inicio: fechaInicio, fecha_fin: fechaFin,
  };
}

async function handleDescargaVerificar(body: Record<string, unknown>, companyId: number) {
  const requestId = (body.request_id as number) || 0;
  if (!requestId) return NextResponse.json({ detail: "request_id es requerido" }, { status: 400 });

  const { data: req } = await query("sat_download_requests", { match: { company_id: companyId, id: requestId }, single: true });
  if (!req) return NextResponse.json({ detail: "Solicitud no encontrada" }, { status: 404 });

  return {
    id: req.id, status: req.status, request_id: req.request_id,
    num_cfdis: req.num_cfdis, num_packages: req.num_packages,
    packages_downloaded: req.packages_downloaded,
    sat_message: req.sat_message, error_message: req.error_message,
  };
}

async function handleDescargaDescargar(body: Record<string, unknown>, companyId: number) {
  const requestId = (body.request_id as number) || 0;
  if (!requestId) return NextResponse.json({ detail: "request_id es requerido" }, { status: 400 });

  const { data: req } = await query("sat_download_requests", { match: { company_id: companyId, id: requestId }, single: true });
  if (!req) return NextResponse.json({ detail: "Solicitud no encontrada" }, { status: 404 });
  if (req.status !== "ready") return NextResponse.json({ detail: `La solicitud no esta lista. Estado actual: ${req.status}` }, { status: 400 });

  return { id: req.id, status: req.status, message: "Descarga requiere autenticacion FIEL. Use el endpoint de descarga con token activo." };
}

// ── Cancellation ──

async function handleCancelar(body: Record<string, unknown>, companyId: number) {
  const uuid = (body.uuid as string) || "";
  const motivo = (body.motivo as string) || "";
  const uuidSustitucion = (body.uuid_sustitucion as string) || undefined;

  const validation = validateCancellationRequest({ uuid, motivo: motivo as "01" | "02" | "03" | "04", uuidSustitucion });
  if (!validation.valid) return NextResponse.json({ detail: validation.error }, { status: 400 });

  const { data: doc } = await query("cfdi_documents", { match: { company_id: companyId, uuid }, single: true }).catch(() => ({ data: null }));
  const { data: inv } = await query("invoices", { match: { company_id: companyId, cfdi_uuid: uuid }, single: true }).catch(() => ({ data: null }));

  const tipoComprobante = (doc?.tipo_comprobante as string) || (inv?.tipo_comprobante as string) || "I";
  const total = Number(doc?.total || inv?.amount_total || 0);
  const rfcReceptor = (doc?.rfc_receptor as string) || (inv?.partner_rfc as string) || "";
  const needsAcceptance = requiresCancellationAcceptance(tipoComprobante, total, rfcReceptor);

  const { data: cancellation } = await insert("sat_cancellation_requests", {
    company_id: companyId, cfdi_uuid: uuid, invoice_id: inv?.id || null,
    motivo, uuid_sustitucion: uuidSustitucion || null, status: "pending",
    requires_acceptance: needsAcceptance,
    acceptance_deadline: needsAcceptance ? new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString() : null,
    requested_by: (body.requested_by as string) || null,
  });

  return {
    id: cancellation?.[0]?.id, uuid, motivo,
    requires_acceptance: needsAcceptance,
    acceptance_deadline: needsAcceptance ? new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString() : null,
    status: "pending",
    message: needsAcceptance
      ? "Cancelacion requiere aceptacion del receptor. Tiene 72 horas para responder."
      : "Cancelacion no requiere aceptacion. Se procesara al enviar al SAT.",
  };
}

async function handleCancelacionAccion(body: Record<string, unknown>, companyId: number, action: "accepted" | "rejected") {
  const cancellationId = (body.cancellation_id as number) || 0;
  if (!cancellationId) return NextResponse.json({ detail: "cancellation_id es requerido" }, { status: 400 });

  const { data: cancellation } = await query("sat_cancellation_requests", { match: { company_id: companyId, id: cancellationId }, single: true });
  if (!cancellation) return NextResponse.json({ detail: "Solicitud de cancelacion no encontrada" }, { status: 404 });

  await update("sat_cancellation_requests", { status: action, resolved_at: new Date().toISOString() }, { id: cancellationId });

  if (action === "accepted") {
    const uuid = cancellation.cfdi_uuid as string;
    if (uuid) {
      await update("cfdi_documents", {
        sat_status: "Cancelado", cancellation_status: "Cancelado con aceptacion",
        updated_at: new Date().toISOString(),
      }, { company_id: companyId, uuid }).catch(() => {});
      await update("invoices", { sat_status: "Cancelado", status: "cancelled" }, { company_id: companyId, cfdi_uuid: uuid }).catch(() => {});
    }
  }

  return { id: cancellationId, status: action, message: action === "accepted" ? "Cancelacion aceptada" : "Cancelacion rechazada" };
}
