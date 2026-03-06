import { NextRequest, NextResponse } from "next/server";
import { hasDB, query } from "@/lib/db";
import { getCompanyId } from "@/lib/auth-helpers";
import { createSyntageClient } from "@/lib/integrations/syntage";
import { getAdminClient } from "@/lib/supabase/admin";

/** Normalize RFC for comparison (uppercase, no spaces). */
function normalizeRfc(rfc: string | null | undefined): string {
  if (!rfc || typeof rfc !== "string") return "";
  return rfc.replace(/\s/g, "").toUpperCase().trim();
}

/**
 * Get company RFC for the given company_id. Used to match Syntage entity to company.
 */
async function getCompanyRfc(companyId: number): Promise<string | null> {
  const admin = getAdminClient();
  const { data } = await admin.from("companies").select("rfc").eq("id", companyId).single();
  return data?.rfc ? normalizeRfc(data.rfc) : null;
}

/**
 * Verifica que el taxpayerId corresponda a la empresa actual (evita ver datos de otra entidad).
 * Acepta si: integration.syntage_taxpayer_id === taxpayerId, o si no hay vinculación y el RFC del taxpayer coincide con company.
 */
async function ensureTaxpayerBelongsToCompany(
  companyId: number,
  taxpayerId: string,
  client: { listTaxpayers(): Promise<{ "hydra:member": unknown[] }> },
): Promise<boolean> {
  const admin = getAdminClient();
  const { data: integration } = await admin
    .from("integrations")
    .select("syntage_taxpayer_id")
    .eq("company_id", companyId)
    .eq("provider", "sat")
    .single();
  if (integration?.syntage_taxpayer_id) {
    return integration.syntage_taxpayer_id === taxpayerId;
  }
  const companyRfc = await getCompanyRfc(companyId);
  if (!companyRfc) return true;
  const data = await client.listTaxpayers();
  const members = (data["hydra:member"] || []) as Array<{ id: string; rfc?: string }>;
  const match = members.find((tp) => tp.id === taxpayerId && normalizeRfc(tp.rfc) === companyRfc);
  return !!match;
}

/**
 * Syntage SAT API — Unified endpoint for all Syntage operations.
 *
 * GET  /api/sat/syntage?action=<action>&...params
 * POST /api/sat/syntage  { action: "<action>", ...params }
 *
 * Actions:
 *   GET:
 *     status          — Test connection + list taxpayers/credentials
 *     credentials     — List linked SAT credentials
 *     credential      — Get credential detail { id }
 *     taxpayers       — List taxpayers
 *     invoices        — List invoices { taxpayerId, page?, itemsPerPage? }
 *     invoice         — Get invoice detail { id }
 *     invoice-cfdi    — Download CFDI { id }
 *     invoice-lines   — Get line items { invoiceId }
 *     invoice-payments— Get payments for invoice { invoiceId }
 *     tax-returns     — List declaraciones { taxpayerId }
 *     tax-return      — Get declaracion detail { id }
 *     tax-return-data — Get financial data from declaracion { id }
 *     tax-compliance  — Get opinion de cumplimiento { taxpayerId }
 *     tax-status      — Get constancia fiscal { taxpayerId }
 *     tax-retentions  — List retenciones { taxpayerId }
 *     certificates    — List e.FIRMA/CSD certificates { entityId }
 *     extractions     — List extractions
 *     extraction      — Get extraction detail { id }
 *     insights-balance    — Balance sheet { taxpayerId }
 *     insights-income     — Income statement { taxpayerId }
 *     insights-cashflow   — Cash flow { insightId }
 *     insights-ratios     — Financial ratios { insightId }
 *     insights-scores     — Risk/credit scores { entityId }
 *     events          — List recent events
 *
 *   POST:
 *     connect         — Link SAT credential { rfc, password, certificate?, privateKey? }
 *     disconnect      — Remove credential { credentialId }
 *     revalidate      — Revalidate expired credential { credentialId }
 *     extract         — Create extraction { taxpayerId, extractor, options? }
 *     stop-extraction — Stop extraction { extractionId }
 *     export          — Generate CSV/XLSX export { taxpayerId, format }
 *     create-webhook  — Register webhook { url, events }
 */

async function getSyntageClient(companyId: number) {
  const { data: integration } = await query("integrations", {
    match: { company_id: companyId, provider: "sat" },
    single: true,
  });
  const config = (integration?.config || {}) as Record<string, string>;
  if (!config.syntageApiKey) {
    throw new Error("NO_API_KEY");
  }
  return { client: createSyntageClient(config), config, integration };
}

// ── GET /api/sat/syntage ──

export async function GET(req: NextRequest) {
  const companyId = await getCompanyId(req);
  if (!companyId) return NextResponse.json({ detail: "No autorizado" }, { status: 401 });
  if (!hasDB()) return NextResponse.json({ detail: "DB no configurada" }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");

  if (!action) {
    return NextResponse.json({ detail: "Falta parametro 'action'" }, { status: 400 });
  }

  let client;
  try {
    const result = await getSyntageClient(companyId);
    client = result.client;
  } catch (e) {
    if (e instanceof Error && e.message === "NO_API_KEY") {
      return NextResponse.json({
        detail: "Syntage no configurado. Agrega tu API Key en Configuracion > SAT.",
        configured: false,
      }, { status: 400 });
    }
    throw e;
  }

  try {
    switch (action) {
      // ── Connection status ── (incluye entidad vinculada a la empresa para no mezclar datos)
      case "status": {
        const status = await client.testConnection();
        const admin = getAdminClient();
        const [companyRes, intRes] = await Promise.all([
          admin.from("companies").select("rfc").eq("id", companyId).single(),
          admin.from("integrations").select("syntage_taxpayer_id").eq("company_id", companyId).eq("provider", "sat").single(),
        ]);
        return NextResponse.json({
          ...status,
          company_rfc: companyRes.data?.rfc ? normalizeRfc(companyRes.data.rfc) : undefined,
          syntage_taxpayer_id: intRes.data?.syntage_taxpayer_id || undefined,
        });
      }

      // ── Credentials ──
      case "credentials": {
        const data = await client.listCredentials();
        return NextResponse.json({ credentials: data["hydra:member"], total: data["hydra:totalItems"] });
      }
      case "credential": {
        const id = searchParams.get("id");
        if (!id) return NextResponse.json({ detail: "Falta parametro 'id'" }, { status: 400 });
        const data = await client.getCredential(id);
        return NextResponse.json(data);
      }

      // ── Taxpayers ── (solo entidades cuyo RFC coincide con el de la empresa para no mezclar datos)
      case "taxpayers": {
        const data = await client.listTaxpayers();
        const companyRfc = await getCompanyRfc(companyId);
        let members = (data["hydra:member"] || []) as Array<{ id: string; rfc?: string; name?: string }>;
        if (companyRfc) {
          members = members.filter((tp) => normalizeRfc(tp.rfc) === companyRfc);
        }
        return NextResponse.json({ taxpayers: members, total: members.length });
      }

      // ── Invoices ──
      case "invoices": {
        const taxpayerId = searchParams.get("taxpayerId");
        if (!taxpayerId) return NextResponse.json({ detail: "Falta parametro 'taxpayerId'" }, { status: 400 });
        const allowed = await ensureTaxpayerBelongsToCompany(companyId, taxpayerId, client);
        if (!allowed) return NextResponse.json({ detail: "La entidad no corresponde a esta empresa" }, { status: 403 });
        const params: Record<string, string> = {};
        for (const [key, val] of searchParams.entries()) {
          if (key !== "action" && key !== "taxpayerId") params[key] = val;
        }
        const data = await client.listInvoices(taxpayerId, params);
        return NextResponse.json({ invoices: data["hydra:member"], total: data["hydra:totalItems"], view: data["hydra:view"] });
      }
      case "invoice": {
        const id = searchParams.get("id");
        if (!id) return NextResponse.json({ detail: "Falta parametro 'id'" }, { status: 400 });
        const data = await client.getInvoice(id);
        return NextResponse.json(data);
      }
      case "invoice-cfdi": {
        const id = searchParams.get("id");
        if (!id) return NextResponse.json({ detail: "Falta parametro 'id'" }, { status: 400 });
        const data = await client.getInvoiceCfdi(id);
        return NextResponse.json(data);
      }
      case "invoice-lines": {
        const invoiceId = searchParams.get("invoiceId");
        if (!invoiceId) return NextResponse.json({ detail: "Falta parametro 'invoiceId'" }, { status: 400 });
        const data = await client.getInvoiceLineItems(invoiceId);
        return NextResponse.json({ lineItems: data["hydra:member"], total: data["hydra:totalItems"] });
      }
      case "invoice-payments": {
        const invoiceId = searchParams.get("invoiceId");
        if (!invoiceId) return NextResponse.json({ detail: "Falta parametro 'invoiceId'" }, { status: 400 });
        const data = await client.getInvoicePayments(invoiceId);
        return NextResponse.json({ payments: data["hydra:member"], total: data["hydra:totalItems"] });
      }

      // ── Tax Returns ──
      case "tax-returns": {
        const taxpayerId = searchParams.get("taxpayerId");
        if (!taxpayerId) return NextResponse.json({ detail: "Falta parametro 'taxpayerId'" }, { status: 400 });
        const allowed = await ensureTaxpayerBelongsToCompany(companyId, taxpayerId, client);
        if (!allowed) return NextResponse.json({ detail: "La entidad no corresponde a esta empresa" }, { status: 403 });
        const data = await client.listTaxReturns(taxpayerId);
        return NextResponse.json({ taxReturns: data["hydra:member"], total: data["hydra:totalItems"] });
      }
      case "tax-return": {
        const id = searchParams.get("id");
        if (!id) return NextResponse.json({ detail: "Falta parametro 'id'" }, { status: 400 });
        const data = await client.getTaxReturn(id);
        return NextResponse.json(data);
      }
      case "tax-return-data": {
        const id = searchParams.get("id");
        if (!id) return NextResponse.json({ detail: "Falta parametro 'id'" }, { status: 400 });
        const data = await client.getTaxReturnData(id);
        return NextResponse.json(data);
      }

      // ── Tax Compliance ──
      case "tax-compliance": {
        const taxpayerId = searchParams.get("taxpayerId");
        if (!taxpayerId) return NextResponse.json({ detail: "Falta parametro 'taxpayerId'" }, { status: 400 });
        const allowed = await ensureTaxpayerBelongsToCompany(companyId, taxpayerId, client);
        if (!allowed) return NextResponse.json({ detail: "La entidad no corresponde a esta empresa" }, { status: 403 });
        const data = await client.listTaxComplianceChecks(taxpayerId);
        return NextResponse.json({ checks: data["hydra:member"], total: data["hydra:totalItems"] });
      }

      // ── Tax Status ──
      case "tax-status": {
        const taxpayerId = searchParams.get("taxpayerId");
        if (!taxpayerId) return NextResponse.json({ detail: "Falta parametro 'taxpayerId'" }, { status: 400 });
        const allowed = await ensureTaxpayerBelongsToCompany(companyId, taxpayerId, client);
        if (!allowed) return NextResponse.json({ detail: "La entidad no corresponde a esta empresa" }, { status: 403 });
        const data = await client.listTaxStatus(taxpayerId);
        return NextResponse.json({ statuses: data["hydra:member"], total: data["hydra:totalItems"] });
      }

      // ── Tax Retentions ──
      case "tax-retentions": {
        const taxpayerId = searchParams.get("taxpayerId");
        if (!taxpayerId) return NextResponse.json({ detail: "Falta parametro 'taxpayerId'" }, { status: 400 });
        const allowed = await ensureTaxpayerBelongsToCompany(companyId, taxpayerId, client);
        if (!allowed) return NextResponse.json({ detail: "La entidad no corresponde a esta empresa" }, { status: 403 });
        const data = await client.listTaxRetentions(taxpayerId);
        return NextResponse.json({ retentions: data["hydra:member"], total: data["hydra:totalItems"] });
      }

      // ── Certificates ──
      case "certificates": {
        const entityId = searchParams.get("entityId");
        if (!entityId) return NextResponse.json({ detail: "Falta parametro 'entityId'" }, { status: 400 });
        const data = await client.listCertificates(entityId);
        return NextResponse.json({ certificates: data["hydra:member"], total: data["hydra:totalItems"] });
      }

      // ── Extractions ──
      case "extractions": {
        const data = await client.listExtractions();
        return NextResponse.json({ extractions: data["hydra:member"], total: data["hydra:totalItems"] });
      }
      case "extraction": {
        const id = searchParams.get("id");
        if (!id) return NextResponse.json({ detail: "Falta parametro 'id'" }, { status: 400 });
        const data = await client.getExtraction(id);
        return NextResponse.json(data);
      }

      // ── Insights ──
      case "insights-balance": {
        const taxpayerId = searchParams.get("taxpayerId");
        if (!taxpayerId) return NextResponse.json({ detail: "Falta parametro 'taxpayerId'" }, { status: 400 });
        const allowed = await ensureTaxpayerBelongsToCompany(companyId, taxpayerId, client);
        if (!allowed) return NextResponse.json({ detail: "La entidad no corresponde a esta empresa" }, { status: 403 });
        const data = await client.getBalanceSheet(taxpayerId);
        return NextResponse.json(data);
      }
      case "insights-income": {
        const taxpayerId = searchParams.get("taxpayerId");
        if (!taxpayerId) return NextResponse.json({ detail: "Falta parametro 'taxpayerId'" }, { status: 400 });
        const allowed = await ensureTaxpayerBelongsToCompany(companyId, taxpayerId, client);
        if (!allowed) return NextResponse.json({ detail: "La entidad no corresponde a esta empresa" }, { status: 403 });
        const data = await client.getIncomeStatement(taxpayerId);
        return NextResponse.json(data);
      }
      case "insights-cashflow": {
        const insightId = searchParams.get("insightId");
        if (!insightId) return NextResponse.json({ detail: "Falta parametro 'insightId'" }, { status: 400 });
        const data = await client.getCashFlow(insightId);
        return NextResponse.json(data);
      }
      case "insights-ratios": {
        const insightId = searchParams.get("insightId");
        if (!insightId) return NextResponse.json({ detail: "Falta parametro 'insightId'" }, { status: 400 });
        const data = await client.getFinancialRatios(insightId);
        return NextResponse.json(data);
      }
      case "insights-scores": {
        const entityId = searchParams.get("entityId");
        if (!entityId) return NextResponse.json({ detail: "Falta parametro 'entityId'" }, { status: 400 });
        const data = await client.getScores(entityId);
        return NextResponse.json(data);
      }

      // ── Events ──
      case "events": {
        const data = await client.listEvents();
        return NextResponse.json({ events: data["hydra:member"], total: data["hydra:totalItems"] });
      }

      default:
        return NextResponse.json({ detail: `Accion desconocida: ${action}` }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    return NextResponse.json({ detail: msg }, { status: 500 });
  }
}

// ── POST /api/sat/syntage ──

export async function POST(req: NextRequest) {
  const companyId = await getCompanyId(req);
  if (!companyId) return NextResponse.json({ detail: "No autorizado" }, { status: 401 });
  if (!hasDB()) return NextResponse.json({ detail: "DB no configurada" }, { status: 500 });

  const body = await req.json();
  const { action, ...params } = body as { action: string; [key: string]: unknown };

  if (!action) {
    return NextResponse.json({ detail: "Falta campo 'action'" }, { status: 400 });
  }

  // "connect" can be called before API key exists (to save it)
  if (action === "save-config") {
    return saveConfig(companyId, params);
  }

  let client;
  try {
    const result = await getSyntageClient(companyId);
    client = result.client;
  } catch (e) {
    if (e instanceof Error && e.message === "NO_API_KEY") {
      return NextResponse.json({
        detail: "Syntage no configurado. Agrega tu API Key en Configuracion > SAT.",
        configured: false,
      }, { status: 400 });
    }
    throw e;
  }

  try {
    switch (action) {
      // ── Credentials ──
      case "connect": {
        const { rfc, password, certificate, privateKey } = params as {
          rfc: string; password: string; certificate?: string; privateKey?: string;
        };
        if (!rfc || !password) return NextResponse.json({ detail: "Faltan RFC y contrasena" }, { status: 400 });
        const credential = await client.createCredential(rfc, password, certificate as string, privateKey as string);
        return NextResponse.json({ success: true, credential });
      }
      case "disconnect": {
        const { credentialId } = params as { credentialId: string };
        if (!credentialId) return NextResponse.json({ detail: "Falta credentialId" }, { status: 400 });
        await client.deleteCredential(credentialId);
        return NextResponse.json({ success: true });
      }
      case "revalidate": {
        const { credentialId } = params as { credentialId: string };
        if (!credentialId) return NextResponse.json({ detail: "Falta credentialId" }, { status: 400 });
        const credential = await client.revalidateCredential(credentialId);
        return NextResponse.json({ success: true, credential });
      }

      // ── Extractions ──
      case "extract": {
        const { taxpayerId, extractor, options } = params as {
          taxpayerId: string; extractor?: string; options?: { period?: { from: string; to: string }; issued?: boolean; received?: boolean };
        };
        if (!taxpayerId) return NextResponse.json({ detail: "Falta taxpayerId" }, { status: 400 });
        const allowed = await ensureTaxpayerBelongsToCompany(companyId, taxpayerId, client);
        if (!allowed) return NextResponse.json({ detail: "La entidad no corresponde a esta empresa" }, { status: 403 });
        const extraction = await client.createExtraction(
          taxpayerId,
          (extractor as string) || "invoice",
          options,
        );
        return NextResponse.json({ success: true, extraction });
      }
      case "stop-extraction": {
        const { extractionId } = params as { extractionId: string };
        if (!extractionId) return NextResponse.json({ detail: "Falta extractionId" }, { status: 400 });
        await client.stopExtraction(extractionId);
        return NextResponse.json({ success: true });
      }

      // ── Exports ──
      case "export": {
        const { taxpayerId, format } = params as { taxpayerId: string; format?: "csv" | "xlsx" };
        if (!taxpayerId) return NextResponse.json({ detail: "Falta taxpayerId" }, { status: 400 });
        const allowed = await ensureTaxpayerBelongsToCompany(companyId, taxpayerId, client);
        if (!allowed) return NextResponse.json({ detail: "La entidad no corresponde a esta empresa" }, { status: 403 });
        const exportData = await client.createExport({
          taxpayer: `/taxpayers/${taxpayerId}`,
          format: format || "csv",
        });
        return NextResponse.json({ success: true, export: exportData });
      }

      // ── Webhooks ──
      case "create-webhook": {
        const { url, events } = params as { url: string; events: string[] };
        if (!url || !events?.length) return NextResponse.json({ detail: "Faltan url y events" }, { status: 400 });
        const webhook = await client.createWebhook(url, events);
        return NextResponse.json({ success: true, webhook });
      }

      // ── Entities ──
      case "create-entity": {
        const { rfc, name } = params as { rfc?: string; name?: string };
        const entity = await client.createEntity({ rfc, name });
        return NextResponse.json({ success: true, entity });
      }

      default:
        return NextResponse.json({ detail: `Accion desconocida: ${action}` }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    return NextResponse.json({ detail: msg }, { status: 500 });
  }
}

// ── Helper: Save Syntage config ──

async function saveConfig(companyId: number, params: Record<string, unknown>) {
  const { syntageApiKey, syntageEnvironment, rfcEmisor } = params as {
    syntageApiKey?: string; syntageEnvironment?: string; rfcEmisor?: string;
  };

  if (!syntageApiKey) {
    return NextResponse.json({ detail: "Falta syntageApiKey" }, { status: 400 });
  }

  const { data: existing } = await query("integrations", {
    match: { company_id: companyId, provider: "sat" },
    single: true,
  });

  const existingConfig = (existing?.config as Record<string, string>) || {};
  const mergedConfig = {
    ...existingConfig,
    syntageApiKey,
    syntageEnvironment: syntageEnvironment || "production",
    ...(rfcEmisor ? { rfcEmisor } : {}),
  };

  const admin = getAdminClient();
  const updatePayload: Record<string, unknown> = {
    config: mergedConfig,
    is_connected: true,
    updated_at: new Date().toISOString(),
  };

  // Resolver entidad Syntage por RFC: solo mostramos datos de la entidad que coincide con la empresa
  const companyRfc = await getCompanyRfc(companyId);
  const rfcToMatch = companyRfc || (rfcEmisor ? normalizeRfc(rfcEmisor) : null);
  if (rfcToMatch) {
    try {
      const client = createSyntageClient(mergedConfig as Record<string, string>);
      const data = await client.listTaxpayers();
      const members = (data["hydra:member"] || []) as Array<{ id: string; rfc?: string }>;
      const match = members.find((tp) => normalizeRfc(tp.rfc) === rfcToMatch);
      if (match) {
        updatePayload.syntage_taxpayer_id = match.id;
      }
    } catch {
      // Si falla la API (ej. key inválida), guardamos config igual; el taxpayer se puede vincular después
    }
  }

  if (existing) {
    await admin.from("integrations").update(updatePayload).eq("company_id", companyId).eq("provider", "sat");
  } else {
    await admin.from("integrations").insert({
      company_id: companyId,
      provider: "sat",
      config: mergedConfig,
      is_connected: true,
      updated_at: updatePayload.updated_at,
      ...(updatePayload.syntage_taxpayer_id ? { syntage_taxpayer_id: updatePayload.syntage_taxpayer_id } : {}),
    });
  }

  // Test connection
  try {
    const client = createSyntageClient(mergedConfig as Record<string, string>);
    const status = await client.testConnection();
    return NextResponse.json({
      success: true,
      message: "Syntage configurado correctamente",
      ...status,
      syntage_taxpayer_id: (updatePayload.syntage_taxpayer_id as string) || undefined,
    });
  } catch {
    return NextResponse.json({
      success: true,
      message: "Configuracion guardada, pero no se pudo verificar la conexion",
      ok: false,
    });
  }
}
