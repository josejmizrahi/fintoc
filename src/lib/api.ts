const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

function getAuthHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("token");
  const tenantId = localStorage.getItem("tenantId") || "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Tenant-Id": tenantId,
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...getAuthHeaders(),
      ...options?.headers,
    },
  });
  if (res.status === 401) {
    // Token expired or invalid - clear auth state
    if (typeof window !== "undefined") {
      localStorage.removeItem("token");
      localStorage.removeItem("tenantId");
      localStorage.removeItem("tenantName");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }
    throw new Error("Sesión expirada. Inicia sesión nuevamente.");
  }
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || `Error ${res.status}`);
  }
  return res.json();
}

/** Unauthenticated request for auth endpoints */
async function authRequest<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || `Error ${res.status}`);
  }
  return res.json();
}

export const api = {
  // Auth
  auth: {
    register: (data: {
      email: string;
      password: string;
      name: string;
      company_name: string;
      rfc: string;
    }) => authRequest<any>("/api/auth/register", data),
    login: (data: { email: string; password: string }) =>
      authRequest<any>("/api/auth/login", data),
    me: () => request<any>("/api/auth/me"),
  },

  // Dashboard
  dashboard: () => request<any>("/api/dashboard"),
  health: () => request<any>("/health"),

  // Payments
  payments: {
    list: (params?: string) => request<any[]>(`/api/payments/${params ? `?${params}` : ""}`),
    get: (id: number) => request<any>(`/api/payments/${id}`),
    payVendor: (data: any) => request<any>("/api/payments/vendor", { method: "POST", body: JSON.stringify(data) }),
    batch: (data: any) => request<any>("/api/payments/batch", { method: "POST", body: JSON.stringify(data) }),
    execute: (id: number) => request<any>(`/api/payments/${id}/execute`, { method: "POST" }),
    schedule: (id: number, date: string) => request<any>(`/api/payments/${id}/schedule?scheduled_date=${date}`, { method: "POST" }),
    scheduled: () => request<any[]>("/api/payments/scheduled/list"),
  },

  // Collections
  collections: {
    pending: (partnerId?: number) => request<any[]>(`/api/collections/pending${partnerId ? `?partner_id=${partnerId}` : ""}`),
    overdue: (days?: number) => request<any[]>(`/api/collections/overdue?days=${days || 0}`),
    customer: (id: number) => request<any>(`/api/collections/customer/${id}`),
    setupClabe: (id: number) => request<any>(`/api/collections/customer/${id}/clabe`, { method: "POST" }),
    setupAll: () => request<any>("/api/collections/clabes/setup-all", { method: "POST" }),
    sync: () => request<any>("/api/collections/clabes/sync", { method: "POST" }),
    paymentLink: (data: any) => request<any>(`/api/collections/payment-link?partner_id=${data.partner_id}&amount=${data.amount}`, { method: "POST" }),
    aging: () => request<any>("/api/collections/aging"),
  },

  // Invoices
  invoices: {
    receivable: (params?: string) => request<any[]>(`/api/invoices/receivable${params ? `?${params}` : ""}`),
    payable: (params?: string) => request<any[]>(`/api/invoices/payable${params ? `?${params}` : ""}`),
    overdueReceivable: (days?: number) => request<any[]>(`/api/invoices/overdue/receivable?days=${days || 0}`),
    overduePayable: (days?: number) => request<any[]>(`/api/invoices/overdue/payable?days=${days || 0}`),
    get: (id: number) => request<any>(`/api/invoices/${id}`),
    cfdi: (id: number) => request<any>(`/api/invoices/${id}/cfdi`),
  },

  // Vendors
  vendors: {
    list: () => request<any[]>("/api/vendors/"),
    get: (id: number) => request<any>(`/api/vendors/${id}`),
    clabe: (id: number) => request<any>(`/api/vendors/${id}/clabe`),
    setClabe: (id: number, clabe: string) => request<any>(`/api/vendors/${id}/clabe?clabe=${clabe}`, { method: "POST" }),
    verify: (id: number) => request<any>(`/api/vendors/${id}/verify-clabe`, { method: "POST" }),
    bills: (id: number) => request<any[]>(`/api/vendors/${id}/bills`),
  },

  // Customers
  customers: {
    list: () => request<any[]>("/api/customers/"),
    search: (q: string) => request<any[]>(`/api/customers/search?q=${q}`),
    get: (id: number) => request<any>(`/api/customers/${id}`),
    clabe: (id: number) => request<any>(`/api/customers/${id}/clabe`),
    invoices: (id: number) => request<any[]>(`/api/customers/${id}/invoices`),
  },

  // Expenses
  expenses: {
    list: (params?: string) => request<any[]>(`/api/expenses/${params ? `?${params}` : ""}`),
    summary: () => request<any>("/api/expenses/summary"),
    create: (data: any) => request<any>("/api/expenses/", { method: "POST", body: JSON.stringify(data) }),
    action: (id: number, data: any) => request<any>(`/api/expenses/${id}/action`, { method: "POST", body: JSON.stringify(data) }),
  },

  // Approvals
  approvals: {
    rules: () => request<any[]>("/api/approvals/rules"),
    createRule: (data: any) => request<any>("/api/approvals/rules", { method: "POST", body: JSON.stringify(data) }),
    pending: (email?: string) => request<any[]>(`/api/approvals/pending${email ? `?approver_email=${email}` : ""}`),
    approve: (id: number, data: any) => request<any>(`/api/approvals/${id}/approve`, { method: "POST", body: JSON.stringify(data) }),
    reject: (id: number, data: any) => request<any>(`/api/approvals/${id}/reject`, { method: "POST", body: JSON.stringify(data) }),
    history: (id: number) => request<any[]>(`/api/approvals/${id}/history`),
  },

  // Treasury
  treasury: {
    snapshot: () => request<any>("/api/treasury/snapshot"),
    forecast: (days?: number) => request<any[]>(`/api/treasury/forecast?days=${days || 30}`),
    cashFlow: (days?: number) => request<any>(`/api/treasury/cash-flow?days=${days || 30}`),
    balance: () => request<any>("/api/treasury/balance"),
    movements: (days?: number) => request<any[]>(`/api/treasury/movements?days=${days || 30}`),
  },

  // Budgets
  budgets: {
    list: () => request<any[]>("/api/budgets/"),
    get: (id: number) => request<any>(`/api/budgets/${id}`),
    create: (data: any) => request<any>("/api/budgets/", { method: "POST", body: JSON.stringify(data) }),
    vsActual: () => request<any[]>("/api/budgets/vs-actual"),
    spend: (id: number, amount: number) => request<any>(`/api/budgets/${id}/spend?amount=${amount}`, { method: "POST" }),
  },

  // Reconciliation
  reconciliation: {
    fintocOdoo: (days?: number) => request<any>(`/api/reconciliation/fintoc-odoo?days=${days || 7}`, { method: "POST" }),
    sat: (days?: number) => request<any>(`/api/reconciliation/sat?days=${days || 7}`, { method: "POST" }),
    history: () => request<any[]>("/api/reconciliation/history"),
  },

  // SAT
  sat: {
    validate: (data: any) => request<any>("/api/sat/validate", { method: "POST", body: JSON.stringify(data) }),
    validateBulk: (data: any) => request<any>("/api/sat/validate/bulk", { method: "POST", body: JSON.stringify(data) }),
    uploadXml: (data: any) => request<any>("/api/sat/upload-xml", { method: "POST", body: JSON.stringify(data) }),
    documents: () => request<any[]>("/api/sat/documents"),
    revalidateAll: () => request<any>("/api/sat/revalidate-all", { method: "POST" }),
  },

  // Reports
  reports: {
    cashFlow: (from?: string, to?: string) => request<any>(`/api/reports/cash-flow${from ? `?date_from=${from}` : ""}${to ? `&date_to=${to}` : ""}`),
    aging: (type: string) => request<any>(`/api/reports/aging/${type}`),
    satCompliance: (days?: number) => request<any>(`/api/reports/sat-compliance?days=${days || 30}`),
    budgetVsActual: () => request<any[]>("/api/reports/budget-vs-actual"),
    vendorSummary: () => request<any[]>("/api/reports/vendor-summary"),
    expenses: () => request<any>("/api/reports/expenses"),
  },

  // Notifications
  notifications: {
    list: (unreadOnly?: boolean) => request<any[]>(`/api/notifications/?unread_only=${unreadOnly || false}`),
    unreadCount: () => request<any>("/api/notifications/unread-count"),
    markRead: (id: number) => request<any>(`/api/notifications/${id}/read`, { method: "POST" }),
    markAllRead: () => request<any>("/api/notifications/mark-all-read", { method: "POST" }),
  },

  // Companies
  companies: {
    list: () => request<any[]>("/api/companies/"),
    create: (data: any) => request<any>(`/api/companies/?name=${data.name}&rfc=${data.rfc}`, { method: "POST" }),
  },

  // Vendor Portal
  vendorPortal: {
    createToken: (partnerId: number) => request<any>(`/api/vendor-portal/token?partner_id=${partnerId}`, { method: "POST" }),
    dashboard: (token: string) => request<any>(`/api/vendor-portal/dashboard?token=${token}`),
  },
};
