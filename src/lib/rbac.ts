export type Role = 'admin' | 'accountant' | 'viewer';

export type Permission =
  | 'payments.read' | 'payments.create' | 'payments.execute' | 'payments.cancel'
  | 'invoices.read' | 'invoices.create' | 'invoices.update' | 'invoices.validate' | 'invoices.cancel'
  | 'vendors.read' | 'vendors.write'
  | 'customers.read' | 'customers.write'
  | 'expenses.read' | 'expenses.write' | 'expenses.approve'
  | 'treasury.read'
  | 'budgets.read' | 'budgets.write'
  | 'reconciliation.read' | 'reconciliation.execute'
  | 'reports.read' | 'reports.export'
  | 'collections.read' | 'collections.write'
  | 'config.read' | 'config.write'
  | 'users.manage'
  | 'approvals.manage'
  | 'audit.read'
  | 'sync.execute'
  | 'sat.read' | 'sat.validate' | 'sat.extract'
  | 'dashboard.read'
  | 'notifications.read' | 'notifications.write';

const PERMISSIONS: Record<Role, Permission[] | ['*']> = {
  admin: ['*'],
  accountant: [
    'payments.read', 'payments.create', 'payments.execute',
    'invoices.read', 'invoices.create', 'invoices.update', 'invoices.validate',
    'vendors.read', 'vendors.write',
    'customers.read', 'customers.write',
    'expenses.read', 'expenses.write', 'expenses.approve',
    'treasury.read',
    'budgets.read', 'budgets.write',
    'reconciliation.read', 'reconciliation.execute',
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
    'expenses.read',
    'reports.read', 'reports.export',
    'collections.read',
    'dashboard.read',
    'notifications.read', 'notifications.write',
  ],
};

export function hasPermission(role: Role | string, perm: Permission | string): boolean {
  const perms = PERMISSIONS[role as Role];
  if (!perms) return false;
  if ((perms as string[]).includes('*')) return true;
  if ((perms as string[]).includes(perm)) return true;
  // Check wildcard patterns like 'invoices.*'
  const [domain] = perm.split('.');
  return (perms as string[]).some(p => p === `${domain}.*`);
}

export const SIDEBAR_VISIBILITY: Record<string, Role[]> = {
  '/': ['admin', 'accountant', 'viewer'],
  '/pagos': ['admin', 'accountant', 'viewer'],
  '/cobranza': ['admin', 'accountant', 'viewer'],
  '/facturas': ['admin', 'accountant', 'viewer'],
  '/proveedores': ['admin', 'accountant', 'viewer'],
  '/clientes': ['admin', 'accountant', 'viewer'],
  '/gastos': ['admin', 'accountant', 'viewer'],
  '/tesoreria': ['admin', 'accountant'],
  '/presupuestos': ['admin', 'accountant'],
  '/aprobaciones': ['admin', 'accountant'],
  '/sat': ['admin', 'accountant'],
  '/conciliacion': ['admin', 'accountant'],
  '/reportes': ['admin', 'accountant', 'viewer'],
  '/configuracion': ['admin'],
};
