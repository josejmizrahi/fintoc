import { NextRequest, NextResponse } from "next/server";
import { hasDB, query, insert, update } from "@/lib/db";
import { getCompanyId, maskConfig, resolveConfig } from "@/lib/auth-helpers";
import { odooJsonRpc, odooAuthenticate } from "@/lib/odoo";
import { fintocGet } from "@/lib/fintoc";
import { testSatReachability } from "@/lib/sat";

// ── GET /api/onboarding — integration status + masked configs ──

export async function GET(req: NextRequest) {
  const companyId = await getCompanyId(req);
  if (!companyId) return NextResponse.json({ detail: "No autorizado" }, { status: 401 });

  if (!hasDB()) {
    return NextResponse.json({
      integrations: { odoo: null, fintoc: null, sat: null },
      onboarding_completed: false,
    });
  }

  const { data: integrations } = await query("integrations", { match: { company_id: companyId } });
  const map: Record<string, unknown> = { odoo: null, fintoc: null, sat: null };
  for (const i of integrations || []) {
    const cfg = maskConfig(i.config as Record<string, string> | null);
    // Include cert file info if present
    if (i.provider === "sat" && cfg) {
      const rawCfg = i.config as Record<string, string> | null;
      if (rawCfg?.certFileName) cfg.certFileName = rawCfg.certFileName;
      if (rawCfg?.keyFileName) cfg.keyFileName = rawCfg.keyFileName;
    }
    map[i.provider as string] = {
      is_connected: i.is_connected,
      last_sync_at: i.last_sync_at,
      last_sync_status: i.last_sync_status,
      last_sync_message: i.last_sync_message,
      cert_uploaded_at: i.cert_uploaded_at,
      config: cfg,
    };
  }

  const { data: company } = await query("companies", { select: "onboarding_completed", match: { id: companyId }, single: true });
  return NextResponse.json({
    integrations: map,
    onboarding_completed: company?.onboarding_completed || false,
  });
}

// ── POST /api/onboarding — save, test, complete ──

export async function POST(req: NextRequest) {
  const companyId = await getCompanyId(req);
  if (!companyId) return NextResponse.json({ detail: "No autorizado" }, { status: 401 });
  if (!hasDB()) return NextResponse.json({ detail: "DB no configurada" }, { status: 500 });

  const body = await req.json();
  const { action, provider, config } = body as {
    action: "save" | "test" | "complete";
    provider?: string;
    config?: Record<string, string>;
  };

  if (action === "complete") {
    await update("companies", { onboarding_completed: true }, { id: companyId });
    return NextResponse.json({ success: true });
  }

  if (!provider || !["odoo", "fintoc", "sat", "general"].includes(provider)) {
    return NextResponse.json({ detail: "Proveedor invalido" }, { status: 400 });
  }

  const { data: existing } = await query("integrations", { match: { company_id: companyId, provider }, single: true });

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

  return NextResponse.json({ detail: "Accion invalida" }, { status: 400 });
}

// ── Odoo: Test ──

async function testOdoo(companyId: number, config: Record<string, string>) {
  const { url, database, user, password } = config;
  if (!url || !database || !user || !password) {
    return NextResponse.json({ success: false, message: "Faltan campos requeridos (URL, base de datos, usuario, contrasena)" });
  }
  try {
    const versionResult = await odooJsonRpc(url, "common", "version", []);
    if (versionResult.error) throw new Error("No se pudo conectar al servidor Odoo");
    const version = versionResult.result as { server_version?: string } | null;
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

// ── Fintoc: Test ──

async function testFintoc(companyId: number, config: Record<string, string>) {
  const { secretKey } = config;
  if (!secretKey) {
    return NextResponse.json({ success: false, message: "Falta la Secret Key de Fintoc" });
  }
  try {
    const accounts = await fintocGet("/accounts", secretKey) as unknown[];
    const count = Array.isArray(accounts) ? accounts.length : 0;
    await update("integrations", {
      is_connected: true, last_sync_status: "connected",
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

// ── SAT: Test ──

async function testSat(companyId: number, config: Record<string, string>) {
  const { rfcEmisor } = config;
  if (!rfcEmisor) return NextResponse.json({ success: false, message: "Falta el RFC del emisor" });

  const rfcRegex = /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/;
  if (!rfcRegex.test(rfcEmisor)) return NextResponse.json({ success: false, message: "Formato de RFC invalido" });

  const { data: existing } = await query("integrations", { match: { company_id: companyId, provider: "sat" }, single: true });
  const cfg = (existing?.config as Record<string, string>) || {};
  const hasCert = !!cfg.certBase64;
  const hasKey = !!cfg.keyBase64;

  const reachable = await testSatReachability(rfcEmisor);
  const certInfo = hasCert && hasKey ? " | Certificados: cargados" : hasCert ? " | Solo .cer cargado" : hasKey ? " | Solo .key cargado" : " | Sin certificados";

  await update("integrations", {
    is_connected: true, last_sync_status: reachable ? "configured" : "warning",
    last_sync_message: reachable
      ? `RFC: ${rfcEmisor} — Servicio SAT verificado${certInfo}`
      : `RFC: ${rfcEmisor} — SAT no responde${certInfo}`,
    updated_at: new Date().toISOString(),
  }, { company_id: companyId, provider: "sat" }).catch(() => {});

  return NextResponse.json({
    success: true,
    message: reachable
      ? `RFC ${rfcEmisor} configurado — servicio SAT verificado${certInfo}`
      : `RFC ${rfcEmisor} configurado — SAT temporalmente no disponible${certInfo}`,
    certificates: { cer: hasCert, key: hasKey },
  });
}
