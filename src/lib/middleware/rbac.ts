import { AuthContext } from './auth';
import { ApiError } from '@/lib/utils/errors';

type Role = 'admin' | 'accountant' | 'viewer';

const PERMISSIONS: Record<Role, string[]> = {
  admin: ['*'],
  accountant: [
    'payments.read', 'payments.create', 'payments.execute',
    'invoices.read', 'invoices.validate', 'invoices.create', 'invoices.update',
    'reconciliation.read', 'reconciliation.execute',
    'vendors.read', 'vendors.write',
    'customers.read', 'customers.write',
    'expenses.read', 'expenses.write', 'expenses.approve',
    'treasury.read',
    'budgets.read', 'budgets.write',
    'reports.read', 'reports.export',
    'collections.read', 'collections.write',
    'audit.read',
    'sync.execute',
    'sat.read', 'sat.validate', 'sat.extract',
    'dashboard.read',
    'notifications.read', 'notifications.write',
  ],
  viewer: [
    'payments.read',
    'invoices.read',
    'vendors.read',
    'customers.read',
    'reports.read',
    'dashboard.read',
    'notifications.read', 'notifications.write',
    'collections.read',
  ],
};

function hasPermission(role: string, permission: string): boolean {
  const perms = PERMISSIONS[role as Role];
  if (!perms) return false;
  if (perms.includes('*')) return true;
  if (perms.includes(permission)) return true;
  // Check wildcard patterns like 'invoices.*'
  const [domain] = permission.split('.');
  return perms.some(p => p === `${domain}.*`);
}

type RbacHandler = (req: Request, ctx: AuthContext) => Promise<Response>;

export function withRbac(permission: string, handler: RbacHandler): RbacHandler {
  return async (req: Request, ctx: AuthContext): Promise<Response> => {
    if (!hasPermission(ctx.role, permission)) {
      throw new ApiError(
        'FORBIDDEN',
        `Rol '${ctx.role}' no tiene permiso '${permission}'`,
        403
      );
    }
    return handler(req, ctx);
  };
}
