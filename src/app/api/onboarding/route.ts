import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth-server";
import { hasDB, query, insert, update } from "@/lib/db";

// ────────────────────────────────────────────────────────────────────────────
// Auth helper
// ────────────────────────────────────────────────────────────────────────────

async function getCompanyId(req: NextRequest): Promise<number | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const payload = await verifyToken(auth.slice(7));
  return payload ? Number(payload.company_id) : null;
}

// ────────────────────────────────────────────────────────────────────────────
// Config masking — return saved configs with sensitive fields masked
// ────────────────────────────────────────────────────────────────────────────

const SENSITIVE_KEYS = new Set(["password", "secretKey", "webhookSecret", "keyPassword", "smtpPassword"]);
const MASK = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";

function maskConfig(config: Record<string, string> | null | undefined): Record<string, string> | null {
  if (!config || typeof config !== "object") return null;
  const masked: Record<string, string> = {};
  for (const [key, val] of Object.entries(config)) {
    masked[key] = (SENSITIVE_KEYS.has(key) && val) ? MASK : val;
  }
  return masked;
}

function resolveConfig(
  frontendConfig: Record<string, string> | undefined,
  savedConfig: Record<string, unknown> | undefined,
): Record<string, string> {
  if (!frontendConfig) return (savedConfig as Record<string, string>) || {};
  if (!savedConfig || typeof savedConfig !== "object") return frontendConfig;
  const resolved = { ...frontendConfig };
  for (const key of Object.keys(resolved)) {
    if (resolved[key] === MASK || resolved[key] === "••••••••") {
      resolved[key] = (savedConfig as Record<string, string>)[key] || "";
    }
  }
  return resolved;
}

// ────────────────────────────────────────────────────────────────────────────
// GET /api/onboarding — integration status + masked configs
// ────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const companyId = await getCompanyId(req);
  if (!companyId) return NextResponse.json({ detail: "No autorizado" }, { status: 401 });

  if (!hasDB()) {
    return NextResponse.json({
      integrations: { odoo: null, fintoc: null, sat: null },
      onboarding_completed: false,
    });
  }

  const { data: integrations } = await query("integrations", {
    match: { company_id: companyId },
  });

  const map: Record<string, unknown> = { odoo: null, fintoc: null, sat: null };
  for (const i of integrations || []) {
    map[i.provider as string] = {
      is_connected: i.is_connected,
      last_sync_at: i.last_sync_at,
      last_sync_status: i.last_sync_status,
      last_sync_message: i.last_sync_message,
      config: maskConfig(i.config as Record<string, string> | null),
    };
  }

  const { data: company } = await query("companies", {
    select: "onboarding_completed",
    match: { id: companyId },
    single: true,
  });

  return NextResponse.json({
    integrations: map,
    onboarding_completed: company?.onboarding_completed || false,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// POST /api/onboarding — save, test, sync, complete
// ────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const companyId = await getCompanyId(req);
  if (!companyId) return NextResponse.json({ detail: "No autorizado" }, { status: 401 });
  if (!hasDB()) return NextResponse.json({ detail: "DB no configurada" }, { status: 500 });

  const body = await req.json();
  const { action, provider, config } = body as {
    action: "save" | "test" | "sync" | "complete";
    provider?: string;
    config?: Record<string, string>;
  };

  // Complete onboarding
  if (action === "complete") {
    await update("companies", { onboarding_completed: true }, { id: companyId });
    return NextResponse.json({ success: true });
  }

  if (!provider || !["odoo", "fintoc", "sat"].includes(provider)) {
    return NextResponse.json({ detail: "Proveedor invalido" }, { status: 400 });
  }

  const { data: existing } = await query("integrations", {
    match: { company_id: companyId, provider },
    single: true,
  });

  // Save config (merging masked fields with real saved values)
  if (action === "save" && config) {
    const mergedConfig = resolveConfig(config, existing?.config as Record<string, string>);
    if (existing) {
      await update("integrations", { config: mergedConfig, updated_at: new Date().toISOString() }, { company_id: companyId, provider });
    } else {
      await insert("integrations", { company_id: companyId, provider, config: mergedConfig });
    }
    return NextResponse.json({ success: true });
  }

  const resolvedCfg = resolveConfig(config, existing?.config as Record<string, string>);

  if (action === "test") {
    if (provider === "odoo") return testOdoo(companyId, resolvedCfg);
    if (provider === "fintoc") return testFintoc(companyId, resolvedCfg);
    if (provider === "sat") return testSat(companyId, resolvedCfg);
  }

  if (action === "sync") {
    if (provider === "odoo") return syncOdoo(companyId, resolvedCfg);
    if (provider === "fintoc") return syncFintoc(companyId, resolvedCfg);
    if (provider === "sat") return syncSat(companyId, resolvedCfg);
  }

  return NextResponse.json({ detail: "Accion invalida" }, { status: 400 });
}

// ════════════════════════════════════════════════════════════════════════════
// ODOO — JSON-RPC (modern standard)
// ════════════════════════════════════════════════════════════════════════════

interface OdooJsonRpcResult {
  jsonrpc: string;
  result?: unknown;
  error?: { message: string; data?: { message?: string } };
}

async function odooJsonRpc(
  url: string,
  service: string,
  method: string,
  args: unknown[],
  timeout = 15000,
): Promise<OdooJsonRpcResult> {
  const res = await fetch(`${url.replace(/\/$/, "")}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      id: Date.now(),
      params: { service, method, args },
    }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function odooAuthenticate(url: string, db: string, login: string, password: string): Promise<number> {
  const result = await odooJsonRpc(url, "common", "authenticate", [db, login, password, {}]);
  if (result.error) throw new Error(result.error.data?.message || result.error.message);
  const uid = result.result as number | false;
  if (!uid) throw new Error("Credenciales invalidas");
  return uid;
}

async function odooSearchRead(
  url: string, db: string, uid: number, password: string,
  model: string, domain: unknown[][], fields: string[],
  limit = 500, offset = 0,
): Promise<Record<string, unknown>[]> {
  const result = await odooJsonRpc(
    url, "object", "execute_kw",
    [db, uid, password, model, "search_read", [domain], { fields, limit, offset }],
    30000,
  );
  if (result.error) throw new Error(result.error.data?.message || result.error.message);
  return (result.result as Record<string, unknown>[]) || [];
}

// Paginated fetch — fetches all records across pages
async function odooFetchAll(
  url: string, db: string, uid: number, password: string,
  model: string, domain: unknown[][], fields: string[],
  maxRecords = 10000,
): Promise<Record<string, unknown>[]> {
  const PAGE = 500;
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  while (offset < maxRecords) {
    const page = await odooSearchRead(url, db, uid, password, model, domain, fields, PAGE, offset);
    all.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// ── Odoo: Test connection ──
async function testOdoo(companyId: number, config: Record<string, string>) {
  const { url, database, user, password } = config;
  if (!url || !database || !user || !password) {
    return NextResponse.json({ success: false, message: "Faltan campos requeridos (URL, base de datos, usuario, contrasena)" });
  }

  try {
    // Version check
    const versionResult = await odooJsonRpc(url, "common", "version", []);
    if (versionResult.error) {
      throw new Error("No se pudo conectar al servidor Odoo");
    }
    const version = versionResult.result as { server_version?: string } | null;

    // Authenticate
    const uid = await odooAuthenticate(url, database, user, password);

    const msg = `UID: ${uid}${version?.server_version ? ` — Odoo ${version.server_version}` : ""}`;
    await update("integrations", { is_connected: true, last_sync_status: "connected", last_sync_message: msg, updated_at: new Date().toISOString() }, { company_id: companyId, provider: "odoo" });
    return NextResponse.json({ success: true, message: `Conexion a Odoo exitosa (${msg})` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    await update("integrations", { is_connected: false, last_sync_status: "error", last_sync_message: msg, updated_at: new Date().toISOString() }, { company_id: companyId, provider: "odoo" }).catch(() => {});
    return NextResponse.json({ success: false, message: `Error conectando a Odoo: ${msg}` });
  }
}

// ── Odoo: Full sync (customers, vendors, invoices, payments) ──
async function syncOdoo(companyId: number, config: Record<string, string>) {
  const { url, database, user, password } = config;
  if (!url || !database || !user || !password) {
    return NextResponse.json({ success: false, message: "Configuracion de Odoo incompleta" });
  }

  const errors: string[] = [];

  try {
    const uid = await odooAuthenticate(url, database, user, password);
    let syncedCustomers = 0, syncedVendors = 0, syncedInvoices = 0, updatedInvoices = 0, syncedPayments = 0;

    // ── Sync customers ──
    try {
      const customers = await odooFetchAll(url, database, uid, password,
        "res.partner", [["customer_rank", ">", 0]], ["id", "name", "vat", "email"]);
      for (const c of customers) {
        if (!c.name) continue;
        const rfc = (c.vat as string) || null;
        const { data: existing } = rfc
          ? await query("customers", { match: { company_id: companyId, rfc }, single: true })
          : await query("customers", { match: { company_id: companyId, name: c.name as string }, single: true });
        if (!existing) {
          await insert("customers", { company_id: companyId, name: c.name, rfc, email: (c.email as string) || null });
          syncedCustomers++;
        }
      }
    } catch (e) { errors.push(`Clientes: ${e instanceof Error ? e.message : "error"}`); }

    // ── Sync vendors ──
    try {
      const vendors = await odooFetchAll(url, database, uid, password,
        "res.partner", [["supplier_rank", ">", 0]], ["id", "name", "vat", "email"]);
      for (const v of vendors) {
        if (!v.name) continue;
        const rfc = (v.vat as string) || null;
        const { data: existing } = rfc
          ? await query("vendors", { match: { company_id: companyId, rfc }, single: true })
          : await query("vendors", { match: { company_id: companyId, name: v.name as string }, single: true });
        if (!existing) {
          await insert("vendors", { company_id: companyId, name: v.name, rfc, email: (v.email as string) || null });
          syncedVendors++;
        }
      }
    } catch (e) { errors.push(`Proveedores: ${e instanceof Error ? e.message : "error"}`); }

    // ── Sync invoices (with CFDI UUID from Mexican localization) ──
    try {
      const invoices = await odooFetchAll(url, database, uid, password,
        "account.move",
        [["move_type", "in", ["out_invoice", "in_invoice"]]],
        ["id", "name", "partner_id", "move_type", "amount_total", "amount_residual",
         "invoice_date", "invoice_date_due", "state", "l10n_mx_edi_cfdi_uuid"]);
      for (const inv of invoices) {
        const odooId = inv.id as number;
        const cfdiUuid = (inv.l10n_mx_edi_cfdi_uuid as string) || null;
        const odooRef = (inv.name as string) || `ODOO-${odooId}`;
        // partner_id returns [id, "name"] in JSON-RPC
        const partnerName = Array.isArray(inv.partner_id) ? (inv.partner_id[1] as string) : (inv.partner_id as string) || "";

        // Dedup: by CFDI UUID first, then by Odoo reference
        let existing = null;
        if (cfdiUuid) {
          const q = await query("invoices", { match: { company_id: companyId, cfdi_uuid: cfdiUuid }, single: true });
          existing = q.data;
        }
        if (!existing) {
          const q = await query("invoices", { match: { company_id: companyId, name: odooRef }, single: true });
          existing = q.data;
        }

        if (!existing) {
          await insert("invoices", {
            company_id: companyId,
            name: odooRef,
            type: inv.move_type === "out_invoice" ? "receivable" : "payable",
            partner_name: partnerName,
            amount_total: Number(inv.amount_total) || 0,
            amount_residual: Number(inv.amount_residual) || 0,
            date_invoice: (inv.invoice_date as string) || null,
            date_due: (inv.invoice_date_due as string) || null,
            status: inv.state === "posted" ? "open" : inv.state === "cancel" ? "cancelled" : "draft",
            cfdi_uuid: cfdiUuid,
          });
          syncedInvoices++;
        } else {
          // Update with latest Odoo data
          await update("invoices", {
            amount_total: Number(inv.amount_total) || (existing as Record<string, unknown>).amount_total,
            amount_residual: Number(inv.amount_residual) ?? (existing as Record<string, unknown>).amount_residual,
            status: inv.state === "posted" ? "open" : inv.state === "cancel" ? "cancelled" : (existing as Record<string, unknown>).status,
            cfdi_uuid: cfdiUuid || (existing as Record<string, unknown>).cfdi_uuid,
          }, { id: (existing as Record<string, unknown>).id });
          updatedInvoices++;
        }
      }
    } catch (e) { errors.push(`Facturas: ${e instanceof Error ? e.message : "error"}`); }

    // ── Sync payments ──
    try {
      const payments = await odooFetchAll(url, database, uid, password,
        "account.payment",
        [["state", "in", ["posted", "sent", "reconciled"]]],
        ["id", "name", "partner_id", "amount", "payment_type", "date", "ref", "currency_id"]);
      for (const p of payments) {
        const ref = (p.ref as string) || (p.name as string) || `ODOO-PAY-${p.id}`;
        const { data: existing } = await query("payments", {
          match: { company_id: companyId, reference_id: ref },
          single: true,
        });
        if (!existing) {
          const partnerName = Array.isArray(p.partner_id) ? (p.partner_id[1] as string) : "";
          const currencyName = Array.isArray(p.currency_id) ? (p.currency_id[1] as string) : "MXN";
          await insert("payments", {
            company_id: companyId,
            direction: p.payment_type === "inbound" ? "inbound" : "outbound",
            status: "confirmed",
            amount: Math.abs(Number(p.amount) || 0),
            currency: currencyName,
            reference_id: ref,
            partner_name: partnerName,
            executed_at: (p.date as string) || new Date().toISOString(),
          });
          syncedPayments++;
        }
      }
    } catch (e) { errors.push(`Pagos: ${e instanceof Error ? e.message : "error"}`); }

    const syncMsg = `Clientes: +${syncedCustomers}, Proveedores: +${syncedVendors}, Facturas: +${syncedInvoices} (${updatedInvoices} act.), Pagos: +${syncedPayments}${errors.length ? ` | Errores: ${errors.join("; ")}` : ""}`;
    await update("integrations", {
      is_connected: true,
      last_sync_at: new Date().toISOString(),
      last_sync_status: errors.length ? "partial" : "success",
      last_sync_message: syncMsg,
      updated_at: new Date().toISOString(),
    }, { company_id: companyId, provider: "odoo" });

    return NextResponse.json({
      success: true,
      message: "Sincronizacion completada",
      synced: { customers: syncedCustomers, vendors: syncedVendors, invoices: syncedInvoices, updated: updatedInvoices, payments: syncedPayments },
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    await update("integrations", { last_sync_status: "error", last_sync_message: msg, last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { company_id: companyId, provider: "odoo" }).catch(() => {});
    return NextResponse.json({ success: false, message: `Error en sincronizacion: ${msg}` });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// FINTOC — Accounts, Movements, Fiscal Invoices
// ════════════════════════════════════════════════════════════════════════════

const FINTOC_BASE = "https://api.fintoc.com/v1";

async function fintocGet(path: string, secretKey: string, params?: Record<string, string>): Promise<unknown> {
  const url = new URL(`${FINTOC_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: secretKey },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 401) throw new Error("API key de Fintoc invalida");
  if (!res.ok) throw new Error(`Fintoc HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json();
}

// ── Fintoc: Test connection ──
async function testFintoc(companyId: number, config: Record<string, string>) {
  const { secretKey } = config;
  if (!secretKey) {
    return NextResponse.json({ success: false, message: "Falta la Secret Key de Fintoc" });
  }

  try {
    const accounts = await fintocGet("/accounts", secretKey) as unknown[];
    const count = Array.isArray(accounts) ? accounts.length : 0;

    await update("integrations", {
      is_connected: true,
      last_sync_status: "connected",
      last_sync_message: `API key valida — ${count} cuenta(s) encontrada(s)`,
      updated_at: new Date().toISOString(),
    }, { company_id: companyId, provider: "fintoc" });

    return NextResponse.json({ success: true, message: `Conexion a Fintoc exitosa — ${count} cuenta(s)` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    await update("integrations", { is_connected: false, last_sync_status: "error", last_sync_message: msg, updated_at: new Date().toISOString() }, { company_id: companyId, provider: "fintoc" }).catch(() => {});
    return NextResponse.json({ success: false, message: msg });
  }
}

// ── Fintoc: Full sync (accounts + movements + fiscal invoices) ──
async function syncFintoc(companyId: number, config: Record<string, string>) {
  const { secretKey, linkToken } = config;
  if (!secretKey) {
    return NextResponse.json({ success: false, message: "Falta la Secret Key de Fintoc" });
  }

  const errors: string[] = [];
  let totalAccounts = 0, totalMovements = 0, newPayments = 0, totalInvoices = 0;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  try {
    // ── 1. Fetch accounts ──
    const accounts = await fintocGet("/accounts", secretKey) as Array<Record<string, unknown>>;
    totalAccounts = Array.isArray(accounts) ? accounts.length : 0;

    // ── 2. For each account, fetch movements (last 30 days) ──
    for (const account of (Array.isArray(accounts) ? accounts : [])) {
      const accountId = account.id as string;
      if (!accountId) continue;

      try {
        const movements = await fintocGet(`/accounts/${accountId}/movements`, secretKey, { since }) as Array<Record<string, unknown>>;
        if (!Array.isArray(movements)) continue;
        totalMovements += movements.length;

        for (const mov of movements) {
          const fintocId = (mov.id as string) || (mov.transaction_id as string);
          if (!fintocId) continue;

          // Check if movement already exists as a payment
          const { data: existing } = await query("payments", {
            match: { company_id: companyId, fintoc_transfer_id: fintocId },
            single: true,
          });

          if (!existing) {
            const amount = Number(mov.amount) || 0;
            await insert("payments", {
              company_id: companyId,
              direction: amount >= 0 ? "inbound" : "outbound",
              status: "confirmed",
              amount: Math.abs(amount),
              currency: (mov.currency as string) || "MXN",
              reference_id: (mov.reference_id as string) || (mov.description as string) || null,
              partner_name: (mov.counterpart as Record<string, unknown>)?.name as string || (mov.description as string) || null,
              fintoc_transfer_id: fintocId,
              executed_at: (mov.post_date as string) || (mov.created_at as string) || new Date().toISOString(),
            });
            newPayments++;
          }
        }
      } catch {
        errors.push(`Movimientos cuenta ${accountId}: error`);
      }
    }

    // ── 3. Fiscal invoices (if link_token is configured) ──
    // Fintoc Fiscal Links allow accessing SAT invoices via GET /v1/invoices?link_token=xxx
    if (linkToken) {
      try {
        const invoices = await fintocGet("/invoices", secretKey, { link_token: linkToken }) as Array<Record<string, unknown>>;
        if (Array.isArray(invoices)) {
          totalInvoices = invoices.length;
          for (const inv of invoices) {
            const invId = inv.id as string;
            if (!invId) continue;

            // Extract issuer/receiver info
            const issuer = inv.issuer as Record<string, unknown> | null;
            const receiver = inv.receiver as Record<string, unknown> | null;
            const issueType = inv.issue_type as string; // "issued" or "received"
            const totalAmount = Number(inv.total_amount) || 0;
            const cfdiUuid = (inv.institution_id as string) || invId;

            // Check if already imported
            const { data: existing } = await query("invoices", {
              match: { company_id: companyId, cfdi_uuid: cfdiUuid },
              single: true,
            });

            if (!existing) {
              await insert("invoices", {
                company_id: companyId,
                name: (inv.number as string) || cfdiUuid,
                type: issueType === "issued" ? "receivable" : "payable",
                partner_name: issueType === "issued"
                  ? (receiver?.name as string) || ""
                  : (issuer?.name as string) || "",
                amount_total: totalAmount / 100, // Fintoc returns amounts in cents
                amount_residual: totalAmount / 100,
                date_invoice: (inv.date as string) || null,
                status: "open",
                cfdi_uuid: cfdiUuid,
                source: "fintoc_fiscal",
              });
            }
          }
        }
      } catch (e) {
        errors.push(`Facturas fiscales: ${e instanceof Error ? e.message : "error"}`);
      }
    }

    const syncMsg = `${totalAccounts} cuentas, ${totalMovements} movimientos (${newPayments} nuevos)${totalInvoices > 0 ? `, ${totalInvoices} facturas fiscales` : ""}${errors.length ? ` | ${errors.join("; ")}` : ""}`;

    await update("integrations", {
      is_connected: true,
      last_sync_at: new Date().toISOString(),
      last_sync_status: errors.length ? "partial" : "success",
      last_sync_message: syncMsg,
      updated_at: new Date().toISOString(),
    }, { company_id: companyId, provider: "fintoc" });

    return NextResponse.json({
      success: true,
      message: "Sincronizacion de Fintoc completada",
      synced: { accounts: totalAccounts, movements: totalMovements, new_payments: newPayments, invoices: totalInvoices },
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    await update("integrations", { last_sync_status: "error", last_sync_message: msg, last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { company_id: companyId, provider: "fintoc" }).catch(() => {});
    return NextResponse.json({ success: false, message: `Error: ${msg}` });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SAT — CFDI Validation via SOAP + configuration
// ════════════════════════════════════════════════════════════════════════════

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// ── SAT: Test configuration (validates RFC format + SAT service reachability) ──
async function testSat(companyId: number, config: Record<string, string>) {
  const { rfcEmisor } = config;
  if (!rfcEmisor) {
    return NextResponse.json({ success: false, message: "Falta el RFC del emisor" });
  }

  const rfcRegex = /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/;
  if (!rfcRegex.test(rfcEmisor)) {
    return NextResponse.json({ success: false, message: "Formato de RFC invalido" });
  }

  // Test SAT SOAP service reachability
  try {
    const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
  <soap:Body>
    <tem:Consulta>
      <tem:expresionImpresa>?re=${escapeXml(rfcEmisor)}&amp;rr=${escapeXml(rfcEmisor)}&amp;tt=0.00&amp;id=00000000-0000-0000-0000-000000000000</tem:expresionImpresa>
    </tem:Consulta>
  </soap:Body>
</soap:Envelope>`;

    const res = await fetch("https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc", {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "http://tempuri.org/IConsultaCFDIService/Consulta" },
      body: soapEnvelope,
      signal: AbortSignal.timeout(15000),
    });

    const reachable = res.ok || res.status === 500; // SAT returns 500 for invalid UUIDs but proves connectivity

    await update("integrations", {
      is_connected: true,
      last_sync_status: reachable ? "configured" : "warning",
      last_sync_message: reachable ? `RFC: ${rfcEmisor} — Servicio SAT verificado` : `RFC: ${rfcEmisor} — SAT no responde`,
      updated_at: new Date().toISOString(),
    }, { company_id: companyId, provider: "sat" }).catch(() => {});

    return NextResponse.json({ success: true, message: reachable ? `RFC ${rfcEmisor} configurado — servicio SAT verificado` : `RFC ${rfcEmisor} configurado — SAT temporalmente no disponible` });
  } catch {
    await update("integrations", {
      is_connected: true,
      last_sync_status: "configured",
      last_sync_message: `RFC: ${rfcEmisor} — Sin verificar`,
      updated_at: new Date().toISOString(),
    }, { company_id: companyId, provider: "sat" }).catch(() => {});
    return NextResponse.json({ success: true, message: `RFC ${rfcEmisor} guardado. No se pudo verificar el servicio SAT.` });
  }
}

// ── SAT: Sync — validate all CFDI UUIDs in our invoices against SAT ──
async function syncSat(companyId: number, config: Record<string, string>) {
  const { rfcEmisor } = config;
  if (!rfcEmisor) {
    return NextResponse.json({ success: false, message: "Configuracion SAT incompleta (falta RFC)" });
  }

  try {
    // Fetch all invoices with CFDI UUIDs
    const { data: invoices } = await query("invoices", {
      match: { company_id: companyId },
    });

    const withCfdi = (invoices || []).filter((inv: Record<string, unknown>) => inv.cfdi_uuid);
    let validated = 0, vigentes = 0, cancelados = 0, errors = 0;

    for (const inv of withCfdi) {
      try {
        const uuid = inv.cfdi_uuid as string;
        const rfcReceptor = rfcEmisor; // Simplified — in production, store per-invoice RFC
        const total = String(Number(inv.amount_total) || 0);

        const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
  <soap:Body>
    <tem:Consulta>
      <tem:expresionImpresa>?re=${escapeXml(rfcEmisor)}&amp;rr=${escapeXml(rfcReceptor)}&amp;tt=${escapeXml(total)}&amp;id=${escapeXml(uuid)}</tem:expresionImpresa>
    </tem:Consulta>
  </soap:Body>
</soap:Envelope>`;

        const res = await fetch("https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc", {
          method: "POST",
          headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "http://tempuri.org/IConsultaCFDIService/Consulta" },
          body: soapEnvelope,
          signal: AbortSignal.timeout(10000),
        });

        const text = await res.text();
        let satStatus = "Sin verificar";
        if (text.includes("Vigente")) { satStatus = "Vigente"; vigentes++; }
        else if (text.includes("Cancelado")) { satStatus = "Cancelado"; cancelados++; }
        else if (text.includes("No Encontrado")) { satStatus = "No encontrado"; }

        // Update invoice SAT status
        await update("invoices", { sat_status: satStatus }, { id: inv.id });
        validated++;
      } catch {
        errors++;
      }
    }

    const syncMsg = `${validated} validados: ${vigentes} vigentes, ${cancelados} cancelados${errors > 0 ? `, ${errors} errores` : ""}`;
    await update("integrations", {
      is_connected: true,
      last_sync_at: new Date().toISOString(),
      last_sync_status: "success",
      last_sync_message: syncMsg,
      updated_at: new Date().toISOString(),
    }, { company_id: companyId, provider: "sat" });

    return NextResponse.json({
      success: true,
      message: `Validacion SAT completada: ${syncMsg}`,
      validated, vigentes, cancelados, errors,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    return NextResponse.json({ success: false, message: `Error en validacion SAT: ${msg}` });
  }
}
