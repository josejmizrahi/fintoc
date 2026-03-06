/**
 * Unified Sync API Route (v2)
 *
 * Replaces both:
 *   - /api/sync (1000+ line monolithic route)
 *   - Individual /api/sync/odoo, /api/sync/fintoc, /api/sync/sat routes
 *
 * Usage:
 *   POST /api/v2/sync { "provider": "odoo" }
 *   POST /api/v2/sync { "provider": "fintoc" }
 *   POST /api/v2/sync { "provider": "syntage", "options": { "dateFrom": "2026-01-01" } }
 */
import { z } from 'zod';
import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth, type AuthContext } from '@/lib/middleware/auth';
import { withValidation } from '@/lib/middleware/validate';
import { withRbac } from '@/lib/middleware/rbac';
import { getProvider } from '@/packages/sync-engine';
import '@/packages/integrations'; // registers all providers

const SyncRequestSchema = z.object({
  provider: z.enum(['odoo', 'fintoc', 'syntage']),
  options: z
    .object({
      dateFrom: z.string().date().optional(),
      dateTo: z.string().date().optional(),
      syncDays: z.number().int().min(1).max(365).optional(),
    })
    .optional(),
});

export const POST = createHandler(
  withAuth(
    withRbac(
      'sync.execute',
      withValidation(SyncRequestSchema, async (req, ctx) => {
        const { provider } = ctx.body;
        const companyId = String(ctx.company_id);

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
    const companyId = String(ctx.company_id);

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
);
