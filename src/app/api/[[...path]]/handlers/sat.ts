/**
 * SAT handlers — extracted from catch-all route (#16)
 */

import { query, insert, update } from "@/lib/db";
import { validateCfdiAgainstSat, parseCfdiXml } from "@/lib/sat";
import { NextResponse } from "next/server";

export async function handleSatGet(path: string, companyId: number): Promise<unknown | null> {
  if (path === "sat/documents") {
    const { data } = await query("cfdi_documents", { match: { company_id: companyId }, order: { column: "fecha_emision" } });
    return data || [];
  }
  return null;
}

export async function handleSatPost(path: string, body: Record<string, unknown>, companyId: number): Promise<Response | unknown | null> {
  // CFDI validation
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

  // Bulk validation
  if (path === "sat/validate/bulk") {
    const uuids = (body.uuids as string[]) || [];
    if (!Array.isArray(uuids) || uuids.length === 0) {
      return NextResponse.json({ detail: "Envía un arreglo de UUIDs" }, { status: 400 });
    }
    const { data: satInt } = await query("integrations", { match: { company_id: companyId, provider: "sat" }, single: true });
    const companyRfc = (satInt?.config as Record<string, string>)?.rfcEmisor || "";
    const results: Array<{ uuid: string; estado: string }> = [];
    for (const uuid of uuids.slice(0, 100)) {
      try {
        const { data: inv } = await query("invoices", { match: { company_id: companyId, cfdi_uuid: uuid }, single: true });
        const total = inv ? String(Number(inv.amount_total) || 0) : "0";
        const isReceivable = inv?.type === "receivable";
        const partnerRfc = (inv?.partner_rfc as string) || companyRfc;
        const satRfcEmisor = isReceivable ? companyRfc : partnerRfc;
        const satRfcReceptor = isReceivable ? partnerRfc : companyRfc;
        const estado = await validateCfdiAgainstSat(uuid, satRfcEmisor, satRfcReceptor, total);
        results.push({ uuid, estado });
        if (inv) await update("invoices", { sat_status: estado }, { id: inv.id });
      } catch {
        results.push({ uuid, estado: "Error" });
      }
    }
    return { validated: results.length, results };
  }

  // Upload XML
  if (path === "sat/upload-xml") {
    const xmlContent = (body.xml_content as string) || "";
    if (!xmlContent.trim()) {
      return NextResponse.json({ detail: "Falta el contenido XML" }, { status: 400 });
    }
    const parsed = parseCfdiXml(xmlContent);
    if (!parsed.uuid) {
      return NextResponse.json({ detail: "No se encontro UUID en el XML" }, { status: 400 });
    }
    const { data: existing } = await query("cfdi_documents", { match: { company_id: companyId, uuid: parsed.uuid }, single: true });
    if (existing) {
      return { id: existing.id, uuid: parsed.uuid, status: "already_exists", rfc_emisor: parsed.rfcEmisor, total: parsed.total };
    }
    const estado = await validateCfdiAgainstSat(parsed.uuid, parsed.rfcEmisor, parsed.rfcReceptor, String(parsed.total));

    const { data: linkedInvoice } = await query("invoices", { match: { company_id: companyId, cfdi_uuid: parsed.uuid }, single: true }).catch(() => ({ data: null }));

    const { data: inserted } = await insert("cfdi_documents", {
      company_id: companyId, uuid: parsed.uuid, rfc_emisor: parsed.rfcEmisor, rfc_receptor: parsed.rfcReceptor,
      nombre_emisor: parsed.nombreEmisor || null, nombre_receptor: parsed.nombreReceptor || null,
      tipo_comprobante: parsed.tipoComprobante || null,
      total: parsed.total, fecha_emision: parsed.fecha || null, fecha_timbrado: parsed.fechaTimbrado || null,
      sat_status: estado, xml_content: xmlContent,
      invoice_id: linkedInvoice ? (linkedInvoice as Record<string, unknown>).id : null,
    });
    const doc = inserted?.[0];

    if (linkedInvoice) {
      await update("invoices", { sat_status: estado }, { id: (linkedInvoice as Record<string, unknown>).id });
    } else {
      const { data: satInt } = await query("integrations", { match: { company_id: companyId, provider: "sat" }, single: true }).catch(() => ({ data: null }));
      const companyRfc = (satInt?.config as Record<string, string>)?.rfcEmisor || "";
      const isEmitted = parsed.rfcEmisor === companyRfc;
      const newInvoice = await insert("invoices", {
        company_id: companyId, name: parsed.uuid,
        type: isEmitted ? "receivable" : "payable",
        partner_name: isEmitted ? parsed.nombreReceptor : parsed.nombreEmisor,
        partner_rfc: isEmitted ? parsed.rfcReceptor : parsed.rfcEmisor,
        amount_total: parsed.total, amount_residual: parsed.total,
        date_invoice: parsed.fecha || null, status: "open",
        cfdi_uuid: parsed.uuid, sat_status: estado, source: "sat_upload",
      });
      if (newInvoice.data?.[0]?.id && doc?.id) {
        await update("cfdi_documents", { invoice_id: newInvoice.data[0].id }, { id: doc.id });
      }
    }

    return { id: doc?.id, uuid: parsed.uuid, rfc_emisor: parsed.rfcEmisor, total: parsed.total, estado, status: "processed", invoice_linked: !!linkedInvoice };
  }

  // Revalidate all
  if (path === "sat/revalidate-all") {
    const { data: docs } = await query("cfdi_documents", { match: { company_id: companyId } });
    const { data: satInt } = await query("integrations", { match: { company_id: companyId, provider: "sat" }, single: true });
    const companyRfc = (satInt?.config as Record<string, string>)?.rfcEmisor || "";
    let revalidated = 0, vigentes = 0, cancelados = 0, errores = 0;
    for (const doc of (docs || []).slice(0, 500)) {
      try {
        const uuid = doc.uuid as string;
        if (!uuid) continue;
        const estado = await validateCfdiAgainstSat(uuid, (doc.rfc_emisor as string) || companyRfc, (doc.rfc_receptor as string) || companyRfc, String(Number(doc.total) || 0));
        await update("cfdi_documents", { sat_status: estado, updated_at: new Date().toISOString() }, { id: doc.id });
        revalidated++;
        if (estado === "Vigente") vigentes++;
        else if (estado === "Cancelado") cancelados++;
      } catch { errores++; }
    }
    const { data: invoices } = await query("invoices", { match: { company_id: companyId } });
    for (const inv of (invoices || []).filter((i: Record<string, unknown>) => i.cfdi_uuid)) {
      try {
        const isReceivable = inv.type === "receivable";
        const partnerRfc = (inv.partner_rfc as string) || companyRfc;
        const satRfcEmisor = isReceivable ? companyRfc : partnerRfc;
        const satRfcReceptor = isReceivable ? partnerRfc : companyRfc;
        const estado = await validateCfdiAgainstSat(inv.cfdi_uuid as string, satRfcEmisor, satRfcReceptor, String(Number(inv.amount_total) || 0));
        await update("invoices", { sat_status: estado }, { id: inv.id });
        revalidated++;
        if (estado === "Vigente") vigentes++;
        else if (estado === "Cancelado") cancelados++;
      } catch { errores++; }
    }
    return { revalidated, vigentes, cancelados, errores };
  }

  return null;
}
