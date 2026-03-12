import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';

/** Stub: cash-flow data is derived from reports/cash-flow. Returns empty to avoid 404. */
export const GET = createHandler(async (req) => {
  return withAuth(withRbac('treasury.read', async () => {
    return Response.json({ data: [] });
  }))(req, { params: Promise.resolve({}) });
}, { rateLimit: 'read' });
