/**
 * Unified Sync API Route (v2)
 *
 * POST /api/v2/sync { "provider": "odoo" }
 * POST /api/v2/sync { "provider": "fintoc" }
 * SAT (Syntage) data is updated via webhooks; no periodic sync.
 */
import { z } from 'zod';
import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withValidation } from '@/lib/middleware/validate';
import { withRbac } from '@/lib/middleware/rbac';
import { getProvider } from '@/packages/sync-engine';
import '@/packages/integrations'; // registers providers

const SyncRequestSchema = z.object({
  provider: z.enum(['odoo', 'fintoc', 'syntage', 'sat']),
  options: z
    .object({
      dateFrom: z.string().date().optional(),
      dateTo: z.string().date().optional(),
      syncDays: z.number().int().min(1).max(365).optional(),
    })
    .optional(),
});

// SAT (Syntage) has no periodic sync — data comes from webhooks; extractions are on-demand via /api/sync/sat
const PROVIDER_ALIASES: Record<string, 'odoo' | 'fintoc' | 'syntage'> = {
  odoo: 'odoo',
  fintoc: 'fintoc',
  syntage: 'syntage',
  sat: 'syntage',
};

export const POST = createHandler(
  withAuth(
    withRbac(
      'sync.execute',
      withValidation(SyncRequestSchema, async (req, ctx) => {
        const provider = PROVIDER_ALIASES[ctx.body.provider] || ctx.body.provider;
        const companyId = String(ctx.company_id);

        // SAT (Syntage): no periodic sync; data via webhooks. Use POST /api/sync/sat for on-demand extractions.
        if (provider === 'syntage') {
          return Response.json({
            success: true,
            data: {
              provider: 'syntage',
              status: 'completed',
              recordsSynced: 0,
              recordsFailed: 0,
              errors: [],
              startedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
              details: {},
              message: 'SAT data is updated via webhooks. Use Sync SAT for on-demand extractions.',
            },
          });
        }

        const engine = getProvider(provider);
        const result = await engine.run(companyId);

        return Response.json({
          success: result.status !== 'failed',
          data: result,
        });
      }),
    ),
  ),
);

/**
 * GET /api/v2/sync — list available providers and their last sync status
 */
export const GET = createHandler(
  withAuth(async (req, ctx) => {
    const { getAdminClient } = await import('@/lib/supabase/admin');
    const admin = getAdminClient();
    const companyId = Number(ctx.company_id);

    const { data: integrations } = await admin
      .from('integrations')
      .select('provider, status, is_connected, last_sync, last_sync_at, last_sync_status')
      .eq('company_id', companyId);

    const { data: recentSyncs } = await admin
      .from('sync_history')
      .select('provider, status, records_synced, completed_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(10);

    return Response.json({
      success: true,
      data: {
        integrations: integrations || [],
        recentSyncs: recentSyncs || [],
      },
    });
  }),
  { rateLimit: 'read' },
);
