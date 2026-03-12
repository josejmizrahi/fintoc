import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { ApiError } from '@/lib/utils/errors';
import { hasDB, query } from '@/lib/db';
import { createSyntageClient } from '@/lib/integrations/syntage';
import { getAdminClient } from '@/lib/supabase/admin';

function normalizeRfc(rfc: string | null | undefined): string {
  if (!rfc || typeof rfc !== 'string') return '';
  return rfc.replace(/\s/g, '').toUpperCase().trim();
}

async function getCompanyRfc(companyId: number): Promise<string | null> {
  const admin = getAdminClient();
  const { data } = await admin.from('companies').select('rfc').eq('id', companyId).single();
  return data?.rfc ? normalizeRfc(data.rfc) : null;
}

async function ensureTaxpayerBelongsToCompany(
  companyId: number,
  taxpayerId: string,
  client: { listTaxpayers(): Promise<{ 'hydra:member': unknown[] }> },
): Promise<boolean> {
  const admin = getAdminClient();
  const { data: integration } = await admin
    .from('integrations')
    .select('syntage_taxpayer_id')
    .eq('company_id', companyId)
    .eq('provider', 'sat')
    .single();
  if (integration?.syntage_taxpayer_id) {
    return integration.syntage_taxpayer_id === taxpayerId;
  }
  const companyRfc = await getCompanyRfc(companyId);
  if (!companyRfc) return true;
  const data = await client.listTaxpayers();
  const members = (data['hydra:member'] || []) as Array<{ id: string; rfc?: string }>;
  const match = members.find((tp) => tp.id === taxpayerId && normalizeRfc(tp.rfc) === companyRfc);
  return !!match;
}

function requireTaxpayer(taxpayerId: string | null): asserts taxpayerId is string {
  if (!taxpayerId) throw new ApiError('VALIDATION_ERROR', "Falta parametro 'taxpayerId'", 400);
}

function requireParam(value: string | null, name: string): asserts value is string {
  if (!value) throw new ApiError('VALIDATION_ERROR', `Falta parametro '${name}'`, 400);
}

async function assertTaxpayerAccess(
  companyId: number,
  taxpayerId: string,
  client: { listTaxpayers(): Promise<{ 'hydra:member': unknown[] }> },
) {
  const allowed = await ensureTaxpayerBelongsToCompany(companyId, taxpayerId, client);
  if (!allowed) throw new ApiError('FORBIDDEN', 'La entidad no corresponde a esta empresa', 403);
}

async function getSyntageClient(companyId: number) {
  const { data: integration } = await query('integrations', {
    match: { company_id: companyId, provider: 'sat' },
    single: true,
  });
  const config = (integration?.config || {}) as Record<string, string>;
  if (!config.syntageApiKey) {
    throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Syntage no configurado. Agrega tu API Key en Configuracion > SAT.', 422);
  }
  return { client: createSyntageClient(config), config, integration };
}

// ── GET /api/sat/syntage ──

export const GET = createHandler(async (req) => {
  return withAuth(async (_req, ctx) => {
    if (!hasDB()) throw new ApiError('INTERNAL_ERROR', 'DB no configurada', 500);
    const companyId = Number(ctx.company_id);

    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');
    if (!action) throw new ApiError('VALIDATION_ERROR', "Falta parametro 'action'", 400);

    const { client } = await getSyntageClient(companyId);

    switch (action) {
      case 'status': {
        const status = await client.testConnection();
        const admin = getAdminClient();
        const [companyRes, intRes] = await Promise.all([
          admin.from('companies').select('rfc').eq('id', companyId).single(),
          admin.from('integrations').select('syntage_taxpayer_id').eq('company_id', companyId).eq('provider', 'sat').single(),
        ]);
        return Response.json({
          ...status,
          company_rfc: companyRes.data?.rfc ? normalizeRfc(companyRes.data.rfc) : undefined,
          syntage_taxpayer_id: intRes.data?.syntage_taxpayer_id || undefined,
        });
      }

      case 'credentials': {
        const data = await client.listCredentials();
        return Response.json({ credentials: data['hydra:member'], total: data['hydra:totalItems'] });
      }
      case 'credential': {
        const id = searchParams.get('id');
        requireParam(id, 'id');
        const data = await client.getCredential(id);
        return Response.json(data);
      }

      case 'taxpayers': {
        const data = await client.listTaxpayers();
        const companyRfc = await getCompanyRfc(companyId);
        let members = (data['hydra:member'] || []) as Array<{ id: string; rfc?: string; name?: string }>;
        if (companyRfc) {
          members = members.filter((tp) => normalizeRfc(tp.rfc) === companyRfc);
        }
        return Response.json({ taxpayers: members, total: members.length });
      }

      case 'invoices': {
        const taxpayerId = searchParams.get('taxpayerId');
        requireTaxpayer(taxpayerId);
        await assertTaxpayerAccess(companyId, taxpayerId, client);
        const params: Record<string, string> = {};
        for (const [key, val] of searchParams.entries()) {
          if (key !== 'action' && key !== 'taxpayerId') params[key] = val;
        }
        const data = await client.listInvoices(taxpayerId, params);
        return Response.json({ invoices: data['hydra:member'], total: data['hydra:totalItems'], view: data['hydra:view'] });
      }
      case 'invoice': {
        const id = searchParams.get('id');
        requireParam(id, 'id');
        const data = await client.getInvoice(id);
        return Response.json(data);
      }
      case 'invoice-cfdi': {
        const id = searchParams.get('id');
        requireParam(id, 'id');
        const data = await client.getInvoiceCfdi(id);
        return Response.json(data);
      }
      case 'invoice-lines': {
        const invoiceId = searchParams.get('invoiceId');
        requireParam(invoiceId, 'invoiceId');
        const data = await client.getInvoiceLineItems(invoiceId);
        return Response.json({ lineItems: data['hydra:member'], total: data['hydra:totalItems'] });
      }
      case 'invoice-payments': {
        const invoiceId = searchParams.get('invoiceId');
        requireParam(invoiceId, 'invoiceId');
        const data = await client.getInvoicePayments(invoiceId);
        return Response.json({ payments: data['hydra:member'], total: data['hydra:totalItems'] });
      }

      case 'tax-returns': {
        const taxpayerId = searchParams.get('taxpayerId');
        requireTaxpayer(taxpayerId);
        await assertTaxpayerAccess(companyId, taxpayerId, client);
        const data = await client.listTaxReturns(taxpayerId);
        return Response.json({ taxReturns: data['hydra:member'], total: data['hydra:totalItems'] });
      }
      case 'tax-return': {
        const id = searchParams.get('id');
        requireParam(id, 'id');
        const data = await client.getTaxReturn(id);
        return Response.json(data);
      }
      case 'tax-return-data': {
        const id = searchParams.get('id');
        requireParam(id, 'id');
        const data = await client.getTaxReturnData(id);
        return Response.json(data);
      }

      case 'tax-compliance': {
        const taxpayerId = searchParams.get('taxpayerId');
        requireTaxpayer(taxpayerId);
        await assertTaxpayerAccess(companyId, taxpayerId, client);
        const data = await client.listTaxComplianceChecks(taxpayerId);
        return Response.json({ checks: data['hydra:member'], total: data['hydra:totalItems'] });
      }

      case 'tax-status': {
        const taxpayerId = searchParams.get('taxpayerId');
        requireTaxpayer(taxpayerId);
        await assertTaxpayerAccess(companyId, taxpayerId, client);
        const data = await client.listTaxStatus(taxpayerId);
        return Response.json({ statuses: data['hydra:member'], total: data['hydra:totalItems'] });
      }

      case 'tax-retentions': {
        const taxpayerId = searchParams.get('taxpayerId');
        requireTaxpayer(taxpayerId);
        await assertTaxpayerAccess(companyId, taxpayerId, client);
        const data = await client.listTaxRetentions(taxpayerId);
        return Response.json({ retentions: data['hydra:member'], total: data['hydra:totalItems'] });
      }

      case 'certificates': {
        const entityId = searchParams.get('entityId');
        requireParam(entityId, 'entityId');
        const data = await client.listCertificates(entityId);
        return Response.json({ certificates: data['hydra:member'], total: data['hydra:totalItems'] });
      }

      case 'extractions': {
        const data = await client.listExtractions();
        return Response.json({ extractions: data['hydra:member'], total: data['hydra:totalItems'] });
      }
      case 'extraction': {
        const id = searchParams.get('id');
        requireParam(id, 'id');
        const data = await client.getExtraction(id);
        return Response.json(data);
      }

      case 'insights-balance': {
        const taxpayerId = searchParams.get('taxpayerId');
        requireTaxpayer(taxpayerId);
        await assertTaxpayerAccess(companyId, taxpayerId, client);
        const data = await client.getBalanceSheet(taxpayerId);
        return Response.json(data);
      }
      case 'insights-income': {
        const taxpayerId = searchParams.get('taxpayerId');
        requireTaxpayer(taxpayerId);
        await assertTaxpayerAccess(companyId, taxpayerId, client);
        const data = await client.getIncomeStatement(taxpayerId);
        return Response.json(data);
      }
      case 'insights-cashflow': {
        const insightId = searchParams.get('insightId');
        requireParam(insightId, 'insightId');
        const data = await client.getCashFlow(insightId);
        return Response.json(data);
      }
      case 'insights-ratios': {
        const insightId = searchParams.get('insightId');
        requireParam(insightId, 'insightId');
        const data = await client.getFinancialRatios(insightId);
        return Response.json(data);
      }
      case 'insights-scores': {
        const entityId = searchParams.get('entityId');
        requireParam(entityId, 'entityId');
        const data = await client.getScores(entityId);
        return Response.json(data);
      }

      case 'events': {
        const data = await client.listEvents();
        return Response.json({ events: data['hydra:member'], total: data['hydra:totalItems'] });
      }

      default:
        throw new ApiError('VALIDATION_ERROR', `Accion desconocida: ${action}`, 400);
    }
  })(req, { params: Promise.resolve({}) });
}, { rateLimit: 'read' });

// ── POST /api/sat/syntage ──

export const POST = createHandler(async (req) => {
  return withAuth(async (_req, ctx) => {
    if (!hasDB()) throw new ApiError('INTERNAL_ERROR', 'DB no configurada', 500);
    const companyId = Number(ctx.company_id);

    const body = await req.json();
    const { action, ...params } = body as { action: string; [key: string]: unknown };
    if (!action) throw new ApiError('VALIDATION_ERROR', "Falta campo 'action'", 400);

    if (action === 'save-config') {
      return saveConfig(companyId, params);
    }

    const { client } = await getSyntageClient(companyId);

    switch (action) {
      case 'connect': {
        const { rfc, password, certificate, privateKey } = params as {
          rfc: string; password: string; certificate?: string; privateKey?: string;
        };
        if (!rfc || !password) throw new ApiError('VALIDATION_ERROR', 'Faltan RFC y contrasena', 400);
        const credential = await client.createCredential(rfc, password, certificate as string, privateKey as string);
        return Response.json({ success: true, credential });
      }
      case 'disconnect': {
        const { credentialId } = params as { credentialId: string };
        requireParam(credentialId || null, 'credentialId');
        await client.deleteCredential(credentialId);
        return Response.json({ success: true });
      }
      case 'revalidate': {
        const { credentialId } = params as { credentialId: string };
        requireParam(credentialId || null, 'credentialId');
        const credential = await client.revalidateCredential(credentialId);
        return Response.json({ success: true, credential });
      }

      case 'extract': {
        const { taxpayerId, extractor, options } = params as {
          taxpayerId: string; extractor?: string; options?: { period?: { from: string; to: string }; issued?: boolean; received?: boolean };
        };
        requireTaxpayer(taxpayerId || null);
        await assertTaxpayerAccess(companyId, taxpayerId, client);
        const extraction = await client.createExtraction(
          taxpayerId,
          (extractor as string) || 'invoice',
          options,
        );
        return Response.json({ success: true, extraction });
      }
      case 'stop-extraction': {
        const { extractionId } = params as { extractionId: string };
        requireParam(extractionId || null, 'extractionId');
        await client.stopExtraction(extractionId);
        return Response.json({ success: true });
      }

      case 'export': {
        const { taxpayerId, format } = params as { taxpayerId: string; format?: 'csv' | 'xlsx' };
        requireTaxpayer(taxpayerId || null);
        await assertTaxpayerAccess(companyId, taxpayerId, client);
        const exportData = await client.createExport({
          taxpayer: `/taxpayers/${taxpayerId}`,
          format: format || 'csv',
        });
        return Response.json({ success: true, export: exportData });
      }

      case 'create-webhook': {
        const { url, events } = params as { url: string; events: string[] };
        if (!url || !events?.length) throw new ApiError('VALIDATION_ERROR', 'Faltan url y events', 400);
        const webhook = await client.createWebhook(url, events);
        return Response.json({ success: true, webhook });
      }

      case 'create-entity': {
        const { rfc, name } = params as { rfc?: string; name?: string };
        const entity = await client.createEntity({ rfc, name });
        return Response.json({ success: true, entity });
      }

      default:
        throw new ApiError('VALIDATION_ERROR', `Accion desconocida: ${action}`, 400);
    }
  })(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });

// ── Helper: Save Syntage config ──

async function saveConfig(companyId: number, params: Record<string, unknown>) {
  const { syntageApiKey, syntageEnvironment, rfcEmisor } = params as {
    syntageApiKey?: string; syntageEnvironment?: string; rfcEmisor?: string;
  };

  if (!syntageApiKey) throw new ApiError('VALIDATION_ERROR', 'Falta syntageApiKey', 400);

  const { data: existing } = await query('integrations', {
    match: { company_id: companyId, provider: 'sat' },
    single: true,
  });

  const existingConfig = (existing?.config as Record<string, string>) || {};
  const mergedConfig = {
    ...existingConfig,
    syntageApiKey,
    syntageEnvironment: syntageEnvironment || 'production',
    ...(rfcEmisor ? { rfcEmisor } : {}),
  };

  const admin = getAdminClient();
  const updatePayload: Record<string, unknown> = {
    config: mergedConfig,
    is_connected: true,
    updated_at: new Date().toISOString(),
  };

  const companyRfc = await getCompanyRfc(companyId);
  const rfcToMatch = companyRfc || (rfcEmisor ? normalizeRfc(rfcEmisor) : null);
  if (rfcToMatch) {
    try {
      const client = createSyntageClient(mergedConfig as Record<string, string>);
      const data = await client.listTaxpayers();
      const members = (data['hydra:member'] || []) as Array<{ id: string; rfc?: string }>;
      const match = members.find((tp) => normalizeRfc(tp.rfc) === rfcToMatch);
      if (match) {
        updatePayload.syntage_taxpayer_id = match.id;
      }
    } catch {
      // If API fails (e.g. invalid key), save config anyway; taxpayer can be linked later
    }
  }

  if (existing) {
    await admin.from('integrations').update(updatePayload).eq('company_id', companyId).eq('provider', 'sat');
  } else {
    await admin.from('integrations').insert({
      company_id: companyId,
      provider: 'sat',
      config: mergedConfig,
      is_connected: true,
      updated_at: updatePayload.updated_at,
      ...(updatePayload.syntage_taxpayer_id ? { syntage_taxpayer_id: updatePayload.syntage_taxpayer_id } : {}),
    });
  }

  try {
    const client = createSyntageClient(mergedConfig as Record<string, string>);
    const status = await client.testConnection();
    return Response.json({
      success: true,
      message: 'Syntage configurado correctamente',
      ...status,
      syntage_taxpayer_id: (updatePayload.syntage_taxpayer_id as string) || undefined,
    });
  } catch {
    return Response.json({
      success: true,
      message: 'Configuracion guardada, pero no se pudo verificar la conexion',
      ok: false,
    });
  }
}
