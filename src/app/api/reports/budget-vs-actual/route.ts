import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { withRbac } from '@/lib/middleware/rbac';

// Reuses same logic as /api/budgets/vs-actual
export { GET } from '@/app/api/budgets/vs-actual/route';
