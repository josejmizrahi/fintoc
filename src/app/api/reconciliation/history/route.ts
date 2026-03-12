import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';

/** Stub: reconciliation history is tracked in sync_history / audit. Returns empty to avoid 404. */
export const GET = createHandler(async (req) => {
  return withAuth(withRbac('reconciliation.execute', async () => {
    return Response.json({ data: [] });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'read' });
