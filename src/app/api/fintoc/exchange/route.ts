import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { ApiError } from '@/lib/utils/errors';
import { hasDB, query, update } from '@/lib/db';
import { fintocExchangeSchema } from '@/lib/validations/schemas';

/**
 * POST /api/fintoc/exchange
 * Exchanges a Fintoc Widget exchange_token for a persistent link_token.
 * The link_token is stored in the integrations config for future API calls.
 */
export const POST = createHandler(async (req) => {
  return withAuth(async (_req, ctx) => {
    if (!hasDB()) throw new ApiError('INTERNAL_ERROR', 'DB no configurada', 500);

    let body: unknown;
    try { body = await req.json(); } catch {
      throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400);
    }

    const parsed = fintocExchangeSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message || 'exchange_token es requerido', 400);
    }

    const exchangeToken = parsed.data.exchange_token;

    const { data: integration } = await query('integrations', {
      match: { company_id: ctx.company_id, provider: 'fintoc' },
      single: true,
    });

    const config = ((integration as Record<string, unknown>)?.config || {}) as Record<string, string>;
    const secretKey = config.secretKey;

    if (!secretKey || secretKey === '••••••••') {
      throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Fintoc Secret Key no configurada', 422);
    }

    const res = await fetch('https://api.fintoc.com/v1/links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: secretKey,
      },
      body: JSON.stringify({ exchange_token: exchangeToken }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      let errorMsg = `Fintoc HTTP ${res.status}`;
      try {
        const parsed = JSON.parse(errorBody);
        errorMsg = parsed?.error?.message || errorMsg;
      } catch { /* use default */ }
      throw new ApiError('FINTOC_ERROR', errorMsg, 502);
    }

    const linkData = await res.json();
    const linkToken = linkData.link_token || linkData.id;

    if (!linkToken) {
      throw new ApiError('FINTOC_ERROR', 'No se recibio link_token de Fintoc', 502);
    }

    const updatedConfig = { ...config, linkToken };
    await update(
      'integrations',
      {
        config: updatedConfig,
        is_connected: true,
        status: 'valid',
        updated_at: new Date().toISOString(),
      },
      { company_id: ctx.company_id, provider: 'fintoc' },
    );

    return Response.json({
      data: { link_token: linkToken, message: 'Cuenta bancaria conectada exitosamente' },
    });
  })(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
