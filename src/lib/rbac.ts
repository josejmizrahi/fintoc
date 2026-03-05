/**
 * Role-Based Access Control (RBAC)
 * Defines permissions per role and provides middleware helpers.
 */

export type Role = "admin" | "manager" | "accountant" | "viewer";
export type Action = "read" | "create" | "update" | "delete" | "execute" | "approve" | "configure";
export type Resource =
  | "payments" | "invoices" | "vendors" | "customers" | "expenses"
  | "budgets" | "approvals" | "collections" | "treasury" | "reports"
  | "sat" | "reconciliation" | "notifications" | "integrations" | "users";

const PERMISSIONS: Record<Role, Record<Action, Resource[] | "*">> = {
  admin: {
    read: "*",
    create: "*",
    update: "*",
    delete: "*",
    execute: "*",
    approve: "*",
    configure: "*",
  },
  manager: {
    read: "*",
    create: ["payments", "invoices", "vendors", "customers", "expenses", "budgets", "approvals", "collections", "notifications", "sat", "reconciliation"],
    update: ["payments", "invoices", "vendors", "customers", "expenses", "budgets", "approvals", "collections", "notifications"],
    delete: ["payments", "invoices", "vendors", "customers", "expenses", "budgets", "notifications"],
    execute: ["payments"],
    approve: ["payments", "expenses"],
    configure: [],
  },
  accountant: {
    read: "*",
    create: ["payments", "invoices", "expenses", "sat", "reconciliation"],
    update: ["invoices", "expenses"],
    delete: [],
    execute: [],
    approve: [],
    configure: [],
  },
  viewer: {
    read: "*",
    create: [],
    update: [],
    delete: [],
    execute: [],
    approve: [],
    configure: [],
  },
};

export function checkPermission(role: string, action: Action, resource: Resource): boolean {
  const perms = PERMISSIONS[role as Role];
  if (!perms) return false;
  const allowed = perms[action];
  if (allowed === "*") return true;
  return Array.isArray(allowed) && allowed.includes(resource);
}

/**
 * Determine the required action and resource from an API path and HTTP method.
 */
export function getActionAndResource(
  method: string,
  path: string,
): { action: Action; resource: Resource } | null {
  const segments = path.split("/").filter(Boolean);
  const resourceName = segments[0] as Resource | undefined;
  if (!resourceName) return null;

  // Map resource aliases
  const resourceMap: Record<string, Resource> = {
    payments: "payments",
    invoices: "invoices",
    vendors: "vendors",
    customers: "customers",
    expenses: "expenses",
    budgets: "budgets",
    approvals: "approvals",
    collections: "collections",
    treasury: "treasury",
    reports: "reports",
    sat: "sat",
    reconciliation: "reconciliation",
    notifications: "notifications",
    integrations: "integrations",
    companies: "integrations",
    "approval-rules": "approvals",
    "fintoc": "integrations",
  };

  const resource = resourceMap[resourceName];
  if (!resource) return null;

  // Special action detection
  const pathStr = segments.join("/");
  if (pathStr.includes("/execute")) return { action: "execute", resource };
  if (pathStr.includes("/approve") || pathStr.includes("/reject")) return { action: "approve", resource };
  if (pathStr.includes("/action") && resourceName === "expenses") return { action: "approve", resource };
  if (resourceName === "integrations" || pathStr.includes("/configure")) return { action: method === "GET" ? "read" : "configure", resource };

  // Method-based action
  switch (method) {
    case "GET": return { action: "read", resource };
    case "POST": return { action: "create", resource };
    case "PUT": return { action: "update", resource };
    case "DELETE": return { action: "delete", resource };
    default: return { action: "read", resource };
  }
}

/**
 * Check if a role is allowed to access a given path with a given method.
 * Returns null if allowed, or an error message if denied.
 */
export function checkRouteAccess(role: string, method: string, path: string): string | null {
  const actionResource = getActionAndResource(method, path);
  if (!actionResource) return null; // Unknown routes pass through

  const { action, resource } = actionResource;
  if (checkPermission(role, action, resource)) return null;

  return `Acceso denegado: rol '${role}' no puede ${action} en ${resource}`;
}
