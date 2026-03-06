import { NextRequest, NextResponse } from "next/server";
import { hasDB, query, insert, update } from "@/lib/db";
import { getCompanyId, maskConfig, resolveConfig } from "@/lib/auth-helpers";
import { encrypt } from "@/lib/utils/crypto";
import { odooAuthenticate, odooVersion } from "@/lib/integrations/odoo";
import { getAccounts } from "@/lib/integrations/fintoc";

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
    // Handle disconnect
    if (config._disconnect === "true") {
      if (existing) {
        await update("integrations", {
          config: null,
          config_encrypted: null,
          is_connected: false,
          status: 'disconnected',
          last_sync_status: "disconnected",
          last_sync_message: "Desconectado manualmente",
          updated_at: new Date().toISOString(),
        }, { company_id: companyId, provider });
      }
      return NextResponse.json({ success: true });
    }

    const mergedConfig = resolveConfig(config, existing?.config as Record<string, string>);

    // Encrypt sensitive config for the sync engine
    let configEncrypted: Buffer | null = null;
    try {
      if (provider === "odoo") {
        configEncrypted = encrypt({
          url: mergedConfig.url || "",
          database: mergedConfig.database || "",
          user: mergedConfig.user || "",
          password: mergedConfig.password || "",
        });
      } else if (provider === "fintoc") {
        configEncrypted = encrypt({
          secret_key: mergedConfig.secretKey || "",
        });
      } else if (provider === "sat") {
        configEncrypted = encrypt({
          syntageApiKey: mergedConfig.syntageApiKey || "",
          rfcEmisor: mergedConfig.rfcEmisor || "",
        });
      }
    } catch (err) {
      console.error("[onboarding] Encryption failed:", err);
      // Still save plaintext config so UI works, but log the error
    }

    const saveData: Record<string, unknown> = {
      config: mergedConfig,
      is_connected: true,
      status: 'valid',
      updated_at: new Date().toISOString(),
    };
    if (configEncrypted) {
      saveData.config_encrypted = configEncrypted;
    }

    if (existing) {
      await update("integrations", saveData, { company_id: companyId, provider });
    } else {
      await insert("integrations", { company_id: companyId, provider, ...saveData });
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
    const version = await odooVersion(url);
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
  const { secretKey, linkToken } = config;
  if (!secretKey) {
    return NextResponse.json({ success: false, message: "Falta la Secret Key de Fintoc" });
  }

  // If we have a linkToken, test the full connection (accounts)
  // If not, just validate the API key by calling a simple endpoint
  try {
    if (linkToken) {
      const accounts = await getAccounts(secretKey, { link_token: linkToken });
      const count = Array.isArray(accounts) ? accounts.length : 0;
      await update("integrations", {
        is_connected: true, last_sync_status: "connected",
        last_sync_message: `API key valida — ${count} cuenta(s) encontrada(s)`,
        updated_at: new Date().toISOString(),
      }, { company_id: companyId, provider: "fintoc" });
      return NextResponse.json({ success: true, message: `Conexion a Fintoc exitosa — ${count} cuenta(s)` });
    } else {
      // Without linkToken we can only validate the key exists
      // The user needs to connect their bank via the Fintoc Widget to get a linkToken
      await update("integrations", {
        is_connected: true, last_sync_status: "connected",
        last_sync_message: "API key guardada. Conecta tu cuenta bancaria con el widget de Fintoc.",
        updated_at: new Date().toISOString(),
      }, { company_id: companyId, provider: "fintoc" });
      return NextResponse.json({
        success: true,
        message: "API key guardada. Conecta tu cuenta bancaria con el widget de Fintoc para sincronizar cuentas y movimientos.",
        needs_link: true,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    await update("integrations", { is_connected: false, last_sync_status: "error", last_sync_message: msg, updated_at: new Date().toISOString() }, { company_id: companyId, provider: "fintoc" }).catch(() => {});
    return NextResponse.json({ success: false, message: msg });
  }
}

// ── SAT: Test ──
// SAT validation is done via Syntage; we only validate RFC format and config here.
async function testSat(companyId: number, config: Record<string, string>) {
  const { rfcEmisor } = config;
  if (!rfcEmisor) return NextResponse.json({ success: false, message: "Falta el RFC del emisor" });

  const rfcRegex = /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/;
  if (!rfcRegex.test(rfcEmisor)) return NextResponse.json({ success: false, message: "Formato de RFC invalido" });

  const { data: existing } = await query("integrations", { match: { company_id: companyId, provider: "sat" }, single: true });
  const cfg = (existing?.config as Record<string, string>) || {};
  const hasCert = !!cfg.certBase64;
  const hasKey = !!cfg.keyBase64;
  const hasSyntage = !!cfg.syntageApiKey;
  const certInfo = hasCert && hasKey ? " | Certificados: cargados" : hasCert ? " | Solo .cer cargado" : hasKey ? " | Solo .key cargado" : " | Sin certificados";

  await update("integrations", {
    is_connected: true,
    last_sync_status: hasSyntage ? "configured" : "warning",
    last_sync_message: hasSyntage
      ? `RFC: ${rfcEmisor} — Syntage configurado${certInfo}`
      : `RFC: ${rfcEmisor} — Configura Syntage para validación SAT${certInfo}`,
    updated_at: new Date().toISOString(),
  }, { company_id: companyId, provider: "sat" }).catch(() => {});

  return NextResponse.json({
    success: true,
    message: hasSyntage
      ? `RFC ${rfcEmisor} configurado — Syntage para validación SAT${certInfo}`
      : `RFC ${rfcEmisor} configurado — Conecta Syntage para validar CFDIs${certInfo}`,
    certificates: { cer: hasCert, key: hasKey },
  });
}
