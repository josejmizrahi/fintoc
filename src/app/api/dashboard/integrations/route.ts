import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';
import { getAdminClient } from '@/lib/supabase/admin';

/**
 * GET /api/dashboard/integrations
 * Returns sync status summary for all integrations (Odoo, Fintoc, SAT)
 * plus active Syntage extractions progress.
 */
export const GET = createHandler(async (req) => {
  return withAuth(withRbac('dashboard.read', async (_req, ctx) => {
    const admin = getAdminClient();

    const [
      integrationsResult,
      recentSyncsResult,
      activeExtractionsResult,
    ] = await Promise.all([
      // Integration configs & connection status
      admin.from('integrations')
        .select('provider, is_connected, last_sync_at, last_sync_status, last_sync_message, updated_at')
        .eq('company_id', ctx.company_id),

      // Last sync per provider (most recent 10 across all providers)
      admin.from('sync_history')
        .select('id, provider, status, records_synced, error_message, started_at, completed_at')
        .eq('company_id', ctx.company_id)
        .order('started_at', { ascending: false })
        .limit(10),

      // Active Syntage extractions (pending/waiting/running)
      admin.from('syntage_extractions')
        .select('id, syntage_extraction_id, extractor, status, records_found, error_message, started_at, completed_at')
        .eq('company_id', ctx.company_id)
        .in('status', ['pending', 'waiting', 'running'])
        .order('started_at', { ascending: false })
        .limit(20),
    ]);

    // Also get recently completed extractions (last 5)
    const { data: recentExtractions } = await admin.from('syntage_extractions')
      .select('id, syntage_extraction_id, extractor, status, records_found, error_message, started_at, completed_at')
      .eq('company_id', ctx.company_id)
      .in('status', ['finished', 'failed', 'stopped', 'cancelled'])
      .order('completed_at', { ascending: false })
      .limit(5);

    const integrations = integrationsResult.data || [];
    const recentSyncs = recentSyncsResult.data || [];
    const activeExtractions = activeExtractionsResult.data || [];

    // Build per-provider status
    const providers = ['odoo', 'fintoc', 'sat'] as const;
    const status: Record<string, unknown> = {};

    for (const provider of providers) {
      const integration = integrations.find((i) => i.provider === provider);
      const providerSyncs = recentSyncs.filter((s) => s.provider === provider);
      const lastSync = providerSyncs[0] || null;
      const isRunning = providerSyncs.some((s) => s.status === 'running');

      status[provider] = {
        is_connected: integration?.is_connected || false,
        last_sync_at: integration?.last_sync_at || null,
        last_sync_status: integration?.last_sync_status || null,
        last_sync_message: integration?.last_sync_message || null,
        is_syncing: isRunning,
        last_sync: lastSync ? {
          id: lastSync.id,
          status: lastSync.status,
          records_synced: lastSync.records_synced,
          error_message: lastSync.error_message,
          started_at: lastSync.started_at,
          completed_at: lastSync.completed_at,
        } : null,
      };
    }

    return Response.json({
      integrations: status,
      extractions: {
        active: activeExtractions,
        recent: recentExtractions || [],
      },
    });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'read' });
