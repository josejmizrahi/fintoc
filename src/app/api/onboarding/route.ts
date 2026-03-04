import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth-server";
import { hasDB, query, insert, update } from "@/lib/db";

async function getCompanyId(req: NextRequest): Promise<number | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const payload = await verifyToken(auth.slice(7));
  return payload ? Number(payload.company_id) : null;
}

// GET /api/onboarding — get current integration status
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

// POST /api/onboarding — save integration or trigger sync
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

  // Upsert integration record
  const { data: existing } = await query("integrations", {
    match: { company_id: companyId, provider },
    single: true,
  });

  if (action === "save" && config) {
    if (existing) {
      await update(
        "integrations",
        { config, updated_at: new Date().toISOString() },
        { company_id: companyId, provider }
      );
    } else {
      await insert("integrations", {
        company_id: companyId,
        provider,
        config,
      });
    }
    return NextResponse.json({ success: true });
  }

  if (action === "test") {
    // Test connection based on provider
    if (provider === "odoo") {
      return await testOdoo(companyId, config || existing?.config || {});
    }
    if (provider === "fintoc") {
      return await testFintoc(companyId, config || existing?.config || {});
    }
    if (provider === "sat") {
      return await testSat(companyId, config || existing?.config || {});
    }
  }

  if (action === "sync") {
    if (provider === "odoo") {
      return await syncOdoo(companyId, existing?.config || config || {});
    }
    if (provider === "fintoc") {
      return await syncFintoc(companyId, existing?.config || config || {});
    }
    return NextResponse.json({ detail: "Sync no soportado para este proveedor" }, { status: 400 });
  }

  return NextResponse.json({ detail: "Accion invalida" }, { status: 400 });
}

// ── Odoo test connection ──
async function testOdoo(companyId: number, config: Record<string, unknown>) {
  const { url, database, user, password } = config as Record<string, string>;
  if (!url || !database || !user || !password) {
    return NextResponse.json({
      success: false,
      message: "Faltan campos requeridos (URL, base de datos, usuario, contrasena)",
    });
  }

  try {
    // Test XML-RPC common endpoint
    const xmlPayload = `<?xml version="1.0"?>
<methodCall>
  <methodName>version</methodName>
  <params></params>
</methodCall>`;

    const res = await fetch(`${url.replace(/\/$/, "")}/xmlrpc/2/common`, {
      method: "POST",
      headers: { "Content-Type": "text/xml" },
      body: xmlPayload,
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      await update(
        "integrations",
        { is_connected: false, last_sync_status: "error", last_sync_message: `HTTP ${res.status}`, updated_at: new Date().toISOString() },
        { company_id: companyId, provider: "odoo" }
      );
      return NextResponse.json({ success: false, message: `Error HTTP ${res.status} conectando a Odoo` });
    }

    const text = await res.text();
    if (!text.includes("methodResponse")) {
      return NextResponse.json({ success: false, message: "Respuesta invalida de Odoo" });
    }

    // Now authenticate
    const authPayload = `<?xml version="1.0"?>
<methodCall>
  <methodName>authenticate</methodName>
  <params>
    <param><value><string>${database}</string></value></param>
    <param><value><string>${user}</string></value></param>
    <param><value><string>${password}</string></value></param>
    <param><value><struct></struct></value></param>
  </params>
</methodCall>`;

    const authRes = await fetch(`${url.replace(/\/$/, "")}/xmlrpc/2/common`, {
      method: "POST",
      headers: { "Content-Type": "text/xml" },
      body: authPayload,
      signal: AbortSignal.timeout(10000),
    });

    const authText = await authRes.text();
    // Check if auth returned a UID (integer) or false (boolean)
    const uidMatch = authText.match(/<int>(\d+)<\/int>/);
    if (!uidMatch) {
      await update(
        "integrations",
        { is_connected: false, last_sync_status: "error", last_sync_message: "Credenciales invalidas", updated_at: new Date().toISOString() },
        { company_id: companyId, provider: "odoo" }
      );
      return NextResponse.json({ success: false, message: "Credenciales de Odoo invalidas" });
    }

    await update(
      "integrations",
      { is_connected: true, last_sync_status: "connected", last_sync_message: `UID: ${uidMatch[1]}`, updated_at: new Date().toISOString() },
      { company_id: companyId, provider: "odoo" }
    );

    return NextResponse.json({ success: true, message: "Conexion a Odoo exitosa", uid: Number(uidMatch[1]) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    await update(
      "integrations",
      { is_connected: false, last_sync_status: "error", last_sync_message: msg, updated_at: new Date().toISOString() },
      { company_id: companyId, provider: "odoo" }
    ).catch(() => {});
    return NextResponse.json({ success: false, message: `Error conectando a Odoo: ${msg}` });
  }
}

// ── Fintoc test connection ──
async function testFintoc(companyId: number, config: Record<string, unknown>) {
  const { secretKey } = config as Record<string, string>;
  if (!secretKey) {
    return NextResponse.json({ success: false, message: "Falta la Secret Key de Fintoc" });
  }

  try {
    const res = await fetch("https://api.fintoc.com/v1/accounts", {
      headers: { Authorization: secretKey },
      signal: AbortSignal.timeout(10000),
    });

    if (res.status === 401) {
      await update(
        "integrations",
        { is_connected: false, last_sync_status: "error", last_sync_message: "API key invalida", updated_at: new Date().toISOString() },
        { company_id: companyId, provider: "fintoc" }
      );
      return NextResponse.json({ success: false, message: "API key de Fintoc invalida" });
    }

    if (!res.ok) {
      return NextResponse.json({ success: false, message: `Error Fintoc: HTTP ${res.status}` });
    }

    await update(
      "integrations",
      { is_connected: true, last_sync_status: "connected", last_sync_message: "API key valida", updated_at: new Date().toISOString() },
      { company_id: companyId, provider: "fintoc" }
    );

    return NextResponse.json({ success: true, message: "Conexion a Fintoc exitosa" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    return NextResponse.json({ success: false, message: `Error conectando a Fintoc: ${msg}` });
  }
}

// ── SAT test ──
async function testSat(companyId: number, config: Record<string, unknown>) {
  const { rfcEmisor } = config as Record<string, string>;
  if (!rfcEmisor) {
    return NextResponse.json({ success: false, message: "Falta el RFC del emisor" });
  }

  // Validate RFC format
  const rfcRegex = /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/;
  if (!rfcRegex.test(rfcEmisor)) {
    return NextResponse.json({ success: false, message: "Formato de RFC invalido" });
  }

  await update(
    "integrations",
    { is_connected: true, last_sync_status: "configured", last_sync_message: `RFC: ${rfcEmisor}`, config, updated_at: new Date().toISOString() },
    { company_id: companyId, provider: "sat" }
  ).catch(() => {});

  return NextResponse.json({ success: true, message: `RFC ${rfcEmisor} configurado correctamente` });
}

// ── Odoo sync (pulls customers, vendors, invoices) ──
async function syncOdoo(companyId: number, config: Record<string, unknown>) {
  const { url, database, user, password } = config as Record<string, string>;
  if (!url || !database || !user || !password) {
    return NextResponse.json({ success: false, message: "Configuracion de Odoo incompleta" });
  }

  try {
    // Authenticate first
    const authPayload = `<?xml version="1.0"?>
<methodCall>
  <methodName>authenticate</methodName>
  <params>
    <param><value><string>${database}</string></value></param>
    <param><value><string>${user}</string></value></param>
    <param><value><string>${password}</string></value></param>
    <param><value><struct></struct></value></param>
  </params>
</methodCall>`;

    const authRes = await fetch(`${url.replace(/\/$/, "")}/xmlrpc/2/common`, {
      method: "POST",
      headers: { "Content-Type": "text/xml" },
      body: authPayload,
      signal: AbortSignal.timeout(10000),
    });
    const authText = await authRes.text();
    const uidMatch = authText.match(/<int>(\d+)<\/int>/);
    if (!uidMatch) {
      return NextResponse.json({ success: false, message: "Error de autenticacion con Odoo" });
    }

    const uid = uidMatch[1];

    // Helper to make XML-RPC object calls
    async function xmlRpcCall(model: string, method: string, domain: string, fields: string[]): Promise<string> {
      const fieldsXml = fields.map(f => `<value><string>${f}</string></value>`).join("");
      const payload = `<?xml version="1.0"?>
<methodCall>
  <methodName>execute_kw</methodName>
  <params>
    <param><value><string>${database}</string></value></param>
    <param><value><int>${uid}</int></value></param>
    <param><value><string>${password}</string></value></param>
    <param><value><string>${model}</string></value></param>
    <param><value><string>${method}</string></value></param>
    <param><value><array><data><value><array><data>${domain}</data></array></value></data></array></value></param>
    <param><value><struct>
      <member><name>fields</name><value><array><data>${fieldsXml}</data></array></value></member>
      <member><name>limit</name><value><int>500</int></value></member>
    </struct></value></param>
  </params>
</methodCall>`;

      const res = await fetch(`${url.replace(/\/$/, "")}/xmlrpc/2/object`, {
        method: "POST",
        headers: { "Content-Type": "text/xml" },
        body: payload,
        signal: AbortSignal.timeout(30000),
      });
      return res.text();
    }

    // Parse XML-RPC struct responses into JS objects
    function parseXmlRecords(xml: string): Record<string, string>[] {
      const records: Record<string, string>[] = [];
      const structMatches = xml.match(/<struct>([\s\S]*?)<\/struct>/g) || [];
      for (const struct of structMatches) {
        const rec: Record<string, string> = {};
        const memberMatches = struct.match(/<member>([\s\S]*?)<\/member>/g) || [];
        for (const member of memberMatches) {
          const nameMatch = member.match(/<name>(.*?)<\/name>/);
          const valMatch = member.match(/<(?:string|int|double|boolean)>(.*?)<\/(?:string|int|double|boolean)>/);
          if (nameMatch && valMatch) {
            rec[nameMatch[1]] = valMatch[1];
          }
        }
        if (Object.keys(rec).length > 0) records.push(rec);
      }
      return records;
    }

    let syncedCustomers = 0;
    let syncedVendors = 0;
    let syncedInvoices = 0;

    // Sync customers (res.partner where customer_rank > 0)
    try {
      const custXml = await xmlRpcCall(
        "res.partner", "search_read",
        `<value><array><data><value><string>customer_rank</string></value><value><string>&gt;</string></value><value><int>0</int></value></data></array>`,
        ["name", "vat", "email"]
      );
      const customers = parseXmlRecords(custXml);
      for (const c of customers) {
        if (!c.name) continue;
        const { data: existing } = await query("customers", {
          match: { company_id: companyId, name: c.name },
          single: true,
        });
        if (!existing) {
          await insert("customers", {
            company_id: companyId,
            name: c.name,
            rfc: c.vat || null,
            email: c.email || null,
          });
          syncedCustomers++;
        }
      }
    } catch { /* skip if model not available */ }

    // Sync vendors (res.partner where supplier_rank > 0)
    try {
      const vendXml = await xmlRpcCall(
        "res.partner", "search_read",
        `<value><array><data><value><string>supplier_rank</string></value><value><string>&gt;</string></value><value><int>0</int></value></data></array>`,
        ["name", "vat", "email"]
      );
      const vendors = parseXmlRecords(vendXml);
      for (const v of vendors) {
        if (!v.name) continue;
        const { data: existing } = await query("vendors", {
          match: { company_id: companyId, name: v.name },
          single: true,
        });
        if (!existing) {
          await insert("vendors", {
            company_id: companyId,
            name: v.name,
            rfc: v.vat || null,
            email: v.email || null,
          });
          syncedVendors++;
        }
      }
    } catch { /* skip */ }

    // Sync invoices (account.move where move_type in ['out_invoice', 'in_invoice'])
    try {
      const invXml = await xmlRpcCall(
        "account.move", "search_read",
        `<value><array><data><value><string>move_type</string></value><value><string>in</string></value><value><array><data><value><string>out_invoice</string></value><value><string>in_invoice</string></value></data></array></value></data></array>`,
        ["name", "partner_id", "move_type", "amount_total", "amount_residual", "invoice_date", "invoice_date_due", "state"]
      );
      const invoices = parseXmlRecords(invXml);
      for (const inv of invoices) {
        if (!inv.name) continue;
        const { data: existing } = await query("invoices", {
          match: { company_id: companyId, cfdi_uuid: inv.name },
          single: true,
        });
        if (!existing) {
          await insert("invoices", {
            company_id: companyId,
            type: inv.move_type === "out_invoice" ? "receivable" : "payable",
            partner_name: inv.partner_id || "",
            amount_total: Number(inv.amount_total) || 0,
            amount_residual: Number(inv.amount_residual) || 0,
            date_invoice: inv.invoice_date || null,
            date_due: inv.invoice_date_due || null,
            status: inv.state === "posted" ? "open" : "draft",
            cfdi_uuid: inv.name,
          });
          syncedInvoices++;
        }
      }
    } catch { /* skip */ }

    // Update integration record
    await update(
      "integrations",
      {
        is_connected: true,
        last_sync_at: new Date().toISOString(),
        last_sync_status: "success",
        last_sync_message: `Clientes: ${syncedCustomers}, Proveedores: ${syncedVendors}, Facturas: ${syncedInvoices}`,
        updated_at: new Date().toISOString(),
      },
      { company_id: companyId, provider: "odoo" }
    );

    return NextResponse.json({
      success: true,
      message: "Sincronizacion completada",
      synced: { customers: syncedCustomers, vendors: syncedVendors, invoices: syncedInvoices },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    await update(
      "integrations",
      { last_sync_status: "error", last_sync_message: msg, last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { company_id: companyId, provider: "odoo" }
    ).catch(() => {});
    return NextResponse.json({ success: false, message: `Error en sincronizacion: ${msg}` });
  }
}

// ── Fintoc sync (list accounts) ──
async function syncFintoc(companyId: number, config: Record<string, unknown>) {
  const { secretKey } = config as Record<string, string>;
  if (!secretKey) {
    return NextResponse.json({ success: false, message: "Falta la Secret Key" });
  }

  try {
    const res = await fetch("https://api.fintoc.com/v1/accounts", {
      headers: { Authorization: secretKey },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return NextResponse.json({ success: false, message: `Error Fintoc: HTTP ${res.status}` });
    }

    const accounts = await res.json();
    await update(
      "integrations",
      {
        is_connected: true,
        last_sync_at: new Date().toISOString(),
        last_sync_status: "success",
        last_sync_message: `${Array.isArray(accounts) ? accounts.length : 0} cuentas encontradas`,
        updated_at: new Date().toISOString(),
      },
      { company_id: companyId, provider: "fintoc" }
    );

    return NextResponse.json({
      success: true,
      message: "Cuentas de Fintoc sincronizadas",
      accounts: Array.isArray(accounts) ? accounts.length : 0,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    return NextResponse.json({ success: false, message: `Error: ${msg}` });
  }
}
