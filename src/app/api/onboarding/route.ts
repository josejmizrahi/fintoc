import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { ApiError } from '@/lib/utils/errors';
import { hasDB, query, insert, update } from '@/lib/db';
import { maskConfig, resolveConfig } from '@/lib/auth-helpers';
import { encrypt } from '@/lib/utils/crypto';
import { odooAuthenticate, odooVersion } from '@/lib/integrations/odoo';
import { getAccounts } from '@/lib/integrations/fintoc';
import { onboardingActionSchema } from '@/lib/validations/schemas';

// ── GET /api/onboarding — integration status + masked configs ──

export const GET = createHandler(async (req) => {
  return withAuth(async (_req, ctx) => {
    if (!hasDB()) {
      return Response.json({
        integrations: { odoo: null, fintoc: null, sat: null },
        onboarding_completed: false,
      });
    }

    const { data: integrations } = await query('integrations', { match: { company_id: ctx.company_id } });
    const map: Record<string, unknown> = { odoo: null, fintoc: null, sat: null };
    for (const i of integrations || []) {
      const cfg = maskConfig(i.config as Record<string, string> | null);
      if (i.provider === 'sat' && cfg) {
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

    const { data: company } = await query('companies', { select: 'onboarding_completed', match: { id: ctx.company_id }, single: true });
    return Response.json({
      integrations: map,
      onboarding_completed: company?.onboarding_completed || false,
    });
  })(req, { params: Promise.resolve({}) });
}, { rateLimit: 'read' });

// ── POST /api/onboarding — save, test, complete ──

export const POST = createHandler(async (req) => {
  return withAuth(async (_req, ctx) => {
    if (!hasDB()) throw new ApiError('INTERNAL_ERROR', 'DB no configurada', 500);
    const companyId = Number(ctx.company_id);

    let body: unknown;
    try { body = await req.json(); } catch {
      throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400);
    }

    const parsed = onboardingActionSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message || 'Error de validacion', 400);
    }

    const { action } = parsed.data;

    if (action === 'complete') {
      await update('companies', { onboarding_completed: true }, { id: ctx.company_id });
      return Response.json({ success: true });
    }

    const { provider, config } = parsed.data;

    const { data: existing } = await query('integrations', { match: { company_id: ctx.company_id, provider }, single: true });

    if (action === 'save' && config) {
      if (config._disconnect === 'true') {
        if (existing) {
          await update('integrations', {
            config: null,
            config_encrypted: null,
            is_connected: false,
            status: 'disconnected',
            last_sync_status: 'disconnected',
            last_sync_message: 'Desconectado manualmente',
            updated_at: new Date().toISOString(),
          }, { company_id: ctx.company_id, provider });
        }
        return Response.json({ success: true });
      }

      const mergedConfig = resolveConfig(config, existing?.config as Record<string, string>);

      let configEncrypted: Buffer | null = null;
      try {
        if (provider === 'odoo') {
          configEncrypted = encrypt({
            url: mergedConfig.url || '',
            database: mergedConfig.database || '',
            user: mergedConfig.user || '',
            password: mergedConfig.password || '',
          });
        } else if (provider === 'fintoc') {
          configEncrypted = encrypt({
            secret_key: mergedConfig.secretKey || '',
          });
        } else if (provider === 'sat') {
          configEncrypted = encrypt({
            syntageApiKey: mergedConfig.syntageApiKey || '',
            rfcEmisor: mergedConfig.rfcEmisor || '',
          });
        }
      } catch (err) {
        console.error('[onboarding] Encryption failed:', err);
        throw new ApiError('INTERNAL_ERROR', 'Error al encriptar configuración. Verifica que ENCRYPTION_KEY esté configurado correctamente.', 500);
      }

      const safeConfig = { ...mergedConfig };
      delete safeConfig.password;
      delete safeConfig.secretKey;
      delete safeConfig.syntageApiKey;

      const saveData: Record<string, unknown> = {
        config: safeConfig,
        is_connected: true,
        status: 'valid',
        updated_at: new Date().toISOString(),
      };
      if (configEncrypted) {
        saveData.config_encrypted = configEncrypted;
      }

      if (existing) {
        await update('integrations', saveData, { company_id: ctx.company_id, provider });
      } else {
        await insert('integrations', { company_id: ctx.company_id, provider, ...saveData });
      }
      return Response.json({ success: true });
    }

    const resolvedCfg = resolveConfig(config, existing?.config as Record<string, string>);

    if (action === 'test') {
      if (provider === 'odoo') return testOdoo(companyId, resolvedCfg);
      if (provider === 'fintoc') return testFintoc(companyId, resolvedCfg);
      if (provider === 'sat') return testSat(companyId, resolvedCfg);
    }

    throw new ApiError('VALIDATION_ERROR', 'Accion invalida', 400);
  })(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });

// ── Odoo: Test ──

async function testOdoo(companyId: number, config: Record<string, string>) {
  const { url, database, user, password } = config;
  if (!url || !database || !user || !password) {
    return Response.json({ success: false, message: 'Faltan campos requeridos (URL, base de datos, usuario, contrasena)' });
  }
  try {
    const version = await odooVersion(url);
    const uid = await odooAuthenticate(url, database, user, password);
    const msg = `UID: ${uid}${version?.server_version ? ` — Odoo ${version.server_version}` : ''}`;
    await update('integrations', { is_connected: true, last_sync_status: 'connected', last_sync_message: msg, updated_at: new Date().toISOString() }, { company_id: companyId, provider: 'odoo' });
    return Response.json({ success: true, message: `Conexion a Odoo exitosa (${msg})` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error desconocido';
    await update('integrations', { is_connected: false, last_sync_status: 'error', last_sync_message: msg, updated_at: new Date().toISOString() }, { company_id: companyId, provider: 'odoo' }).catch(() => {});
    return Response.json({ success: false, message: `Error conectando a Odoo: ${msg}` });
  }
}

// ── Fintoc: Test ──

async function testFintoc(companyId: number, config: Record<string, string>) {
  const { secretKey, linkToken } = config;
  if (!secretKey) {
    return Response.json({ success: false, message: 'Falta la Secret Key de Fintoc' });
  }

  try {
    if (linkToken) {
      const accounts = await getAccounts(secretKey, { link_token: linkToken });
      const count = Array.isArray(accounts) ? accounts.length : 0;
      await update('integrations', {
        is_connected: true, last_sync_status: 'connected',
        last_sync_message: `API key valida — ${count} cuenta(s) encontrada(s)`,
        updated_at: new Date().toISOString(),
      }, { company_id: companyId, provider: 'fintoc' });
      return Response.json({ success: true, message: `Conexion a Fintoc exitosa — ${count} cuenta(s)` });
    } else {
      await update('integrations', {
        is_connected: true, last_sync_status: 'connected',
        last_sync_message: 'API key guardada. Conecta tu cuenta bancaria con el widget de Fintoc.',
        updated_at: new Date().toISOString(),
      }, { company_id: companyId, provider: 'fintoc' });
      return Response.json({
        success: true,
        message: 'API key guardada. Conecta tu cuenta bancaria con el widget de Fintoc para sincronizar cuentas y movimientos.',
        needs_link: true,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error desconocido';
    await update('integrations', { is_connected: false, last_sync_status: 'error', last_sync_message: msg, updated_at: new Date().toISOString() }, { company_id: companyId, provider: 'fintoc' }).catch(() => {});
    return Response.json({ success: false, message: msg });
  }
}

// ── SAT: Test ──
async function testSat(companyId: number, config: Record<string, string>) {
  const { rfcEmisor } = config;
  if (!rfcEmisor) return Response.json({ success: false, message: 'Falta el RFC del emisor' });

  const rfcRegex = /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/;
  if (!rfcRegex.test(rfcEmisor)) return Response.json({ success: false, message: 'Formato de RFC invalido' });

  const { data: existing } = await query('integrations', { match: { company_id: companyId, provider: 'sat' }, single: true });
  const cfg = (existing?.config as Record<string, string>) || {};
  const hasCert = !!cfg.certBase64;
  const hasKey = !!cfg.keyBase64;
  const hasSyntage = !!cfg.syntageApiKey;
  const certInfo = hasCert && hasKey ? ' | Certificados: cargados' : hasCert ? ' | Solo .cer cargado' : hasKey ? ' | Solo .key cargado' : ' | Sin certificados';

  await update('integrations', {
    is_connected: true,
    last_sync_status: hasSyntage ? 'configured' : 'warning',
    last_sync_message: hasSyntage
      ? `RFC: ${rfcEmisor} — Syntage configurado${certInfo}`
      : `RFC: ${rfcEmisor} — Configura Syntage para validación SAT${certInfo}`,
    updated_at: new Date().toISOString(),
  }, { company_id: companyId, provider: 'sat' }).catch(() => {});

  return Response.json({
    success: true,
    message: hasSyntage
      ? `RFC ${rfcEmisor} configurado — Syntage para validación SAT${certInfo}`
      : `RFC ${rfcEmisor} configurado — Conecta Syntage para validar CFDIs${certInfo}`,
    certificates: { cer: hasCert, key: hasKey },
  });
}
