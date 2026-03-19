export type Role = 'admin' | 'accountant' | 'viewer';

export type Permission =
  | 'payments:read' | 'payments:create' | 'payments:execute' | 'payments:cancel'
  | 'invoices:read' | 'invoices:validate' | 'invoices:cancel-cfdi'
  | 'vendors:read' | 'vendors:write' | 'customers:read' | 'customers:write'
  | 'expenses:read' | 'expenses:write' | 'expenses:approve'
  | 'treasury:read' | 'budgets:read' | 'budgets:write'
  | 'reconciliation:read' | 'reconciliation:execute'
  | 'reports:read' | 'reports:export'
  | 'config:read' | 'config:write' | 'users:manage' | 'approvals:manage'
  | 'audit:read' | 'sync:execute';

const PERMISSIONS: Record<Role, Permission[] | ['*']> = {
  admin: ['*'],
  accountant: [
    'payments:read', 'payments:create', 'payments:execute',
    'invoices:read', 'invoices:validate',
    'vendors:read', 'vendors:write', 'customers:read', 'customers:write',
    'expenses:read', 'expenses:write',
    'treasury:read', 'budgets:read', 'budgets:write',
    'reconciliation:read', 'reconciliation:execute',
    'reports:read', 'reports:export',
    'audit:read', 'sync:execute',
  ],
  viewer: [
    'payments:read', 'invoices:read', 'vendors:read', 'customers:read',
    'expenses:read', 'reports:read', 'reports:export',
  ],
};

export function hasPermission(role: Role | string, perm: Permission): boolean {
  const perms = PERMISSIONS[role as Role];
  if (!perms) return false;
  return (perms as string[]).includes('*') || (perms as string[]).includes(perm);
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
  '/sincronizacion': ['admin', 'accountant'],
  '/conciliacion': ['admin', 'accountant'],
  '/reportes': ['admin', 'accountant', 'viewer'],
  '/configuracion': ['admin'],
};

// --- Legacy API route compatibility ---

type Action = 'read' | 'create' | 'update' | 'delete' | 'execute' | 'approve' | 'configure';
type Resource =
  | 'payments' | 'invoices' | 'vendors' | 'customers' | 'expenses'
  | 'budgets' | 'approvals' | 'collections' | 'treasury' | 'reports'
  | 'sat' | 'reconciliation' | 'notifications' | 'integrations' | 'users';

const LEGACY_PERMISSIONS: Record<string, Record<Action, Resource[] | '*'>> = {
  admin: { read: '*', create: '*', update: '*', delete: '*', execute: '*', approve: '*', configure: '*' },
  manager: {
    read: '*',
    create: ['payments', 'invoices', 'vendors', 'customers', 'expenses', 'budgets', 'approvals', 'collections', 'notifications', 'sat', 'reconciliation'],
    update: ['payments', 'invoices', 'vendors', 'customers', 'expenses', 'budgets', 'approvals', 'collections', 'notifications'],
    delete: ['payments', 'invoices', 'vendors', 'customers', 'expenses', 'budgets', 'notifications'],
    execute: ['payments'],
    approve: ['payments', 'expenses'],
    configure: [],
  },
  accountant: {
    read: '*',
    create: ['payments', 'invoices', 'expenses', 'sat', 'reconciliation'],
    update: ['invoices', 'expenses'],
    delete: [],
    execute: ['payments'],
    approve: [],
    configure: [],
  },
  viewer: {
    read: '*',
    create: [],
    update: [],
    delete: [],
    execute: [],
    approve: [],
    configure: [],
  },
};

export function checkPermission(role: string, action: Action, resource: Resource): boolean {
  const perms = LEGACY_PERMISSIONS[role];
  if (!perms) return false;
  const allowed = perms[action];
  if (allowed === '*') return true;
  return Array.isArray(allowed) && allowed.includes(resource);
}

export function getActionAndResource(method: string, path: string): { action: Action; resource: Resource } | null {
  const segments = path.split('/').filter(Boolean);
  const resourceName = segments[0] as Resource | undefined;
  if (!resourceName) return null;

  const resourceMap: Record<string, Resource> = {
    payments: 'payments', invoices: 'invoices', vendors: 'vendors',
    customers: 'customers', expenses: 'expenses', budgets: 'budgets',
    approvals: 'approvals', collections: 'collections', treasury: 'treasury',
    reports: 'reports', sat: 'sat', reconciliation: 'reconciliation',
    notifications: 'notifications', integrations: 'integrations',
    companies: 'integrations', 'approval-rules': 'approvals', fintoc: 'integrations',
  };

  const resource = resourceMap[resourceName];
  if (!resource) return null;

  const pathStr = segments.join('/');
  if (pathStr.includes('/execute')) return { action: 'execute', resource };
  if (pathStr.includes('/approve') || pathStr.includes('/reject')) return { action: 'approve', resource };
  if (pathStr.includes('/action') && resourceName === 'expenses') return { action: 'approve', resource };
  if (resourceName === 'integrations' || pathStr.includes('/configure'))
    return { action: method === 'GET' ? 'read' : 'configure', resource };

  switch (method) {
    case 'GET': return { action: 'read', resource };
    case 'POST': return { action: 'create', resource };
    case 'PUT': return { action: 'update', resource };
    case 'DELETE': return { action: 'delete', resource };
    default: return { action: 'read', resource };
  }
}

export function checkRouteAccess(role: string, method: string, path: string): string | null {
  const actionResource = getActionAndResource(method, path);
  if (!actionResource) return null;
  const { action, resource } = actionResource;
  if (checkPermission(role, action, resource)) return null;
  return `Acceso denegado: rol '${role}' no puede ${action} en ${resource}`;
}
