import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { hasDB, query } from '@/lib/db';

/**
 * GET /api/sync-logs?provider=odoo&limit=10
 * Returns sync history for the company (from sync_history table), optionally filtered by provider.
 */
export const GET = createHandler(async (req) => {
  return withAuth(async (_req, ctx) => {
    if (!hasDB()) return Response.json({ data: [] });

    const url = new URL(req.url);
    const provider = url.searchParams.get('provider');
    const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 100);

    const match: Record<string, unknown> = { company_id: ctx.company_id };
    if (provider) match.provider = provider;

    const { data: logs } = await query('sync_history', {
      match,
      order: { column: 'started_at', ascending: false },
      limit,
    });

    return Response.json({ data: logs || [] });
  })(req, { params: Promise.resolve({}) });
}, { rateLimit: 'read' });
