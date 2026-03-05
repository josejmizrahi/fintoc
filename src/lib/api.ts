const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

function getAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('token');
  const company = JSON.parse(localStorage.getItem('activeCompany') || '{}');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (company?.id) headers['X-Tenant-Id'] = company.id;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: { ...getAuthHeaders(), ...options?.headers },
  });

  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('activeCompany');
      window.location.href = '/login';
    }
    throw new ApiError(401, 'Sesion expirada. Inicia sesion nuevamente.');
  }

  if (res.status === 403) {
    throw new ApiError(403, 'No tienes permisos para esta accion');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = body.detail || body.error?.message || (typeof body.error === 'string' ? body.error : `Error ${res.status}`);
    throw new ApiError(res.status, message, body.error?.code || body.code);
  }

  return res.json();
}

async function authRequest<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    const message = body.detail || body.error?.message || (typeof body.error === 'string' ? body.error : `Error ${res.status}`);
    throw new ApiError(res.status, message, body.error?.code);
  }
  return res.json();
}

function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const searchParams = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        searchParams.set(k, String(v));
      }
    });
  }
  const qs = searchParams.toString();
  return request<T>(`${url}${qs ? `?${qs}` : ''}`);
}

function post<T>(url: string, data?: unknown): Promise<T> {
  return request<T>(url, { method: 'POST', body: data ? JSON.stringify(data) : undefined });
}

function put<T>(url: string, data?: unknown): Promise<T> {
  return request<T>(url, { method: 'PUT', body: data ? JSON.stringify(data) : undefined });
}

function del<T>(url: string): Promise<T> {
  return request<T>(url, { method: 'DELETE' });
}

export const api = {
  get,
  post,
  put,
  del,

  auth: {
    register: (data: { email: string; password: string; name?: string; company_name: string; rfc: string }) =>
      authRequest<any>('/api/auth/register', data),
    login: (data: { email: string; password: string }) =>
      authRequest<any>('/api/auth/login', data),
    me: () => get<any>('/api/auth/me'),
    resetPassword: (data: { email: string }) =>
      authRequest<any>('/api/auth/reset-password', data),
    switchCompany: (data: { company_id: string }) =>
      post<any>('/api/auth/switch-company', data),
  },

  payments: {
    list: (params?: Record<string, unknown>) => get<any>('/api/payments', params),
    get: (id: number | string) => get<any>(`/api/payments/${id}`),
    create: (data: any) => post<any>('/api/payments', data),
    execute: (data: { payment_id: number | string }) => post<any>('/api/payments/execute', data),
    executeBatch: (data: { payment_ids: (number | string)[] }) => post<any>('/api/payments/execute-batch', data),
    cancel: (id: number | string) => post<any>(`/api/payments/${id}/cancel`),
    retry: (id: number | string) => post<any>(`/api/payments/${id}/retry`),
    payVendor: (data: any) => post<any>('/api/payments/vendor', data),
    pollStatus: (id: number | string) => post<any>(`/api/payments/${id}/poll-status`),
    pollStuck: () => post<any>('/api/payments/poll-stuck'),
    writebackOdoo: (id: number | string) => post<any>(`/api/payments/${id}/writeback-odoo`),
    scheduled: () => get<any[]>('/api/payments/scheduled/list'),
  },

  invoices: {
    list: (params?: Record<string, unknown>) => get<any>('/api/invoices', params),
    payable: (params?: Record<string, unknown>) => get<any[]>('/api/invoices/payable', params),
    receivable: (params?: Record<string, unknown>) => get<any[]>('/api/invoices/receivable', params),
    get: (id: number | string) => get<any>(`/api/invoices/${id}`),
    cfdi: (id: number | string) => get<any>(`/api/invoices/${id}/cfdi`),
    overdueReceivable: (days?: number) => get<any[]>('/api/invoices/overdue/receivable', { days }),
    overduePayable: (days?: number) => get<any[]>('/api/invoices/overdue/payable', { days }),
  },

  vendors: {
    list: (params?: Record<string, unknown>) => get<any[]>('/api/vendors', params),
    get: (id: number | string) => get<any>(`/api/vendors/${id}`),
    create: (data: any) => post<any>('/api/vendors', data),
    update: (id: number | string, data: any) => put<any>(`/api/vendors/${id}`, data),
    verifyClabe: (id: number | string) => post<any>(`/api/vendors/${id}/verify-clabe`),
    bills: (id: number | string) => get<any[]>(`/api/vendors/${id}/bills`),
  },

  customers: {
    list: (params?: Record<string, unknown>) => get<any[]>('/api/customers', params),
    get: (id: number | string) => get<any>(`/api/customers/${id}`),
    create: (data: any) => post<any>('/api/customers', data),
    update: (id: number | string, data: any) => put<any>(`/api/customers/${id}`, data),
    createClabe: (id: number | string) => post<any>(`/api/customers/${id}/create-clabe`),
    invoices: (id: number | string) => get<any[]>(`/api/customers/${id}/invoices`),
    search: (q: string) => get<any[]>('/api/customers/search', { q }),
  },

  collections: {
    pending: (params?: Record<string, unknown>) => get<any[]>('/api/collections/pending', params),
    overdue: (params?: Record<string, unknown>) => get<any[]>('/api/collections/overdue', params),
    aging: () => get<any>('/api/collections/aging'),
    paymentLink: (data: any) => post<any>('/api/collections/payment-links', data),
    sendReminder: (data: any) => post<any>('/api/collections/send-reminder', data),
    summary: () => get<any>('/api/collections/summary'),
    overdueSummary: () => get<any>('/api/collections/overdue-summary'),
  },

  expenses: {
    list: (params?: Record<string, unknown>) => get<any[]>('/api/expenses', params),
    create: (data: any) => post<any>('/api/expenses', data),
    approve: (id: number | string) => post<any>(`/api/expenses/${id}/approve`),
    reject: (id: number | string, reason: string) => post<any>(`/api/expenses/${id}/reject`, { reason }),
    summary: () => get<any>('/api/expenses/summary'),
  },

  treasury: {
    snapshot: () => get<any>('/api/treasury/snapshot'),
    forecast: (days?: number) => get<any>('/api/treasury/forecast', { days }),
    movements: (params?: Record<string, unknown>) => get<any[]>('/api/treasury/movements', params),
    balance: () => get<any>('/api/treasury/balance'),
    cashFlow: (days?: number) => get<any>('/api/treasury/cash-flow', { days }),
  },

  budgets: {
    list: () => get<any[]>('/api/budgets'),
    get: (id: number | string) => get<any>(`/api/budgets/${id}`),
    create: (data: any) => post<any>('/api/budgets', data),
    vsActual: () => get<any[]>('/api/budgets/vs-actual'),
  },

  approvals: {
    rules: () => get<any[]>('/api/approvals/rules'),
    createRule: (data: any) => post<any>('/api/approvals/rules', data),
    pending: (params?: Record<string, unknown>) => get<any[]>('/api/approvals/pending', params),
    approve: (id: number | string) => post<any>(`/api/approvals/${id}/approve`),
    reject: (id: number | string, reason: string) => post<any>(`/api/approvals/${id}/reject`, { reason }),
  },

  sat: {
    validate: (data: any) => post<any>('/api/sat/validate', data),
    validateBulk: () => post<any>('/api/sat/validate/bulk'),
    validateRfc: (data: any) => post<any>('/api/sat/validate-rfc', data),
    checkEfos: (data: any) => post<any>('/api/sat/check-efos', data),
    uploadXml: (data: any) => post<any>('/api/sat/upload-xml', data),
    documents: (params?: Record<string, unknown>) => get<any[]>('/api/sat/documents', params),
    cancel: (data: any) => post<any>('/api/sat/cancel', data),
    descargaSolicitud: (data: any) => post<any>('/api/sat/descarga/solicitud', data),
    descargaVerificar: (data: any) => post<any>('/api/sat/descarga/verificar', data),
    upload: (data: any) => post<any>('/api/sat/upload', data),

    // ── Syntage (sat.ws) ──
    syntage: {
      // GET actions
      status: () => get<any>('/api/sat/syntage', { action: 'status' }),
      credentials: () => get<any>('/api/sat/syntage', { action: 'credentials' }),
      credential: (id: string) => get<any>('/api/sat/syntage', { action: 'credential', id }),
      taxpayers: () => get<any>('/api/sat/syntage', { action: 'taxpayers' }),
      invoices: (taxpayerId: string, params?: Record<string, unknown>) =>
        get<any>('/api/sat/syntage', { action: 'invoices', taxpayerId, ...params }),
      invoice: (id: string) => get<any>('/api/sat/syntage', { action: 'invoice', id }),
      invoiceCfdi: (id: string) => get<any>('/api/sat/syntage', { action: 'invoice-cfdi', id }),
      invoiceLines: (invoiceId: string) => get<any>('/api/sat/syntage', { action: 'invoice-lines', invoiceId }),
      invoicePayments: (invoiceId: string) => get<any>('/api/sat/syntage', { action: 'invoice-payments', invoiceId }),
      taxReturns: (taxpayerId: string) => get<any>('/api/sat/syntage', { action: 'tax-returns', taxpayerId }),
      taxReturn: (id: string) => get<any>('/api/sat/syntage', { action: 'tax-return', id }),
      taxReturnData: (id: string) => get<any>('/api/sat/syntage', { action: 'tax-return-data', id }),
      taxCompliance: (taxpayerId: string) => get<any>('/api/sat/syntage', { action: 'tax-compliance', taxpayerId }),
      taxStatus: (taxpayerId: string) => get<any>('/api/sat/syntage', { action: 'tax-status', taxpayerId }),
      taxRetentions: (taxpayerId: string) => get<any>('/api/sat/syntage', { action: 'tax-retentions', taxpayerId }),
      certificates: (entityId: string) => get<any>('/api/sat/syntage', { action: 'certificates', entityId }),
      extractions: () => get<any>('/api/sat/syntage', { action: 'extractions' }),
      extraction: (id: string) => get<any>('/api/sat/syntage', { action: 'extraction', id }),
      insightsBalance: (taxpayerId: string) => get<any>('/api/sat/syntage', { action: 'insights-balance', taxpayerId }),
      insightsIncome: (taxpayerId: string) => get<any>('/api/sat/syntage', { action: 'insights-income', taxpayerId }),
      insightsCashflow: (insightId: string) => get<any>('/api/sat/syntage', { action: 'insights-cashflow', insightId }),
      insightsRatios: (insightId: string) => get<any>('/api/sat/syntage', { action: 'insights-ratios', insightId }),
      insightsScores: (entityId: string) => get<any>('/api/sat/syntage', { action: 'insights-scores', entityId }),
      events: () => get<any>('/api/sat/syntage', { action: 'events' }),

      // POST actions
      saveConfig: (data: { syntageApiKey: string; syntageEnvironment?: string; rfcEmisor?: string }) =>
        post<any>('/api/sat/syntage', { action: 'save-config', ...data }),
      connect: (data: { rfc: string; password: string; certificate?: string; privateKey?: string }) =>
        post<any>('/api/sat/syntage', { action: 'connect', ...data }),
      disconnect: (credentialId: string) =>
        post<any>('/api/sat/syntage', { action: 'disconnect', credentialId }),
      revalidate: (credentialId: string) =>
        post<any>('/api/sat/syntage', { action: 'revalidate', credentialId }),
      extract: (taxpayerId: string, extractor?: string, options?: { period?: { from: string; to: string }; issued?: boolean; received?: boolean }) =>
        post<any>('/api/sat/syntage', { action: 'extract', taxpayerId, extractor, options }),
      stopExtraction: (extractionId: string) =>
        post<any>('/api/sat/syntage', { action: 'stop-extraction', extractionId }),
      export: (taxpayerId: string, format?: 'csv' | 'xlsx') =>
        post<any>('/api/sat/syntage', { action: 'export', taxpayerId, format }),
      createWebhook: (url: string, events: string[]) =>
        post<any>('/api/sat/syntage', { action: 'create-webhook', url, events }),
      createEntity: (data: { rfc?: string; name?: string }) =>
        post<any>('/api/sat/syntage', { action: 'create-entity', ...data }),
    },
  },

  reconciliation: {
    satOdoo: (data: any) => post<any>('/api/reconciliation/sat-odoo', data),
    satApp: (data: any) => post<any>('/api/reconciliation/sat-app', data),
    bancoApp: (data: any) => post<any>('/api/reconciliation/banco-app', data),
    history: () => get<any[]>('/api/reconciliation/history'),
    importToOdoo: (data: any) => post<any>('/api/reconciliation/import-to-odoo', data),
  },

  reports: {
    cashFlow: (params?: Record<string, unknown>) => get<any>('/api/reports/cash-flow', params),
    aging: (params?: Record<string, unknown>) => get<any>('/api/reports/aging', params),
    satCompliance: (params?: Record<string, unknown>) => get<any>('/api/reports/sat-compliance', params),
    budgetVsActual: () => get<any[]>('/api/reports/budget-vs-actual'),
    vendorSummary: () => get<any[]>('/api/reports/vendor-summary'),
    customerSummary: () => get<any[]>('/api/reports/customer-summary'),
  },

  notifications: {
    list: (params?: Record<string, unknown>) => get<any[]>('/api/notifications', params),
    markRead: (ids: (number | string)[]) => post<any>('/api/notifications/mark-read', { notification_ids: ids }),
    unreadCount: () => get<any>('/api/notifications/unread-count'),
  },

  onboarding: {
    status: () => get<any>('/api/onboarding'),
    test: (provider: string, config: Record<string, string>) =>
      post<any>('/api/onboarding', { action: 'test', provider, config }),
    save: (provider: string, config: Record<string, string>) =>
      post<any>('/api/onboarding', { action: 'save', provider, config }),
    complete: () => post<any>('/api/onboarding', { action: 'complete' }),
  },

  sync: {
    trigger: (provider: string) => post<any>('/api/sync', { provider }),
    logs: () => get<any[]>('/api/sync'),
  },

  audit: {
    list: (params?: Record<string, unknown>) => get<any[]>('/api/audit', params),
    forEntity: (entityType: string, entityId: string) =>
      get<any[]>('/api/audit', { entity_type: entityType, entity_id: entityId }),
  },

  search: (q: string) => get<any>('/api/search', { q }),

  companies: {
    list: () => get<any[]>('/api/companies'),
    create: (data: any) => post<any>('/api/companies', data),
  },

  users: {
    list: () => get<any[]>('/api/users'),
    invite: (data: any) => post<any>('/api/users/invite', data),
    updateRole: (id: string, role: string) => put<any>(`/api/users/${id}/role`, { role }),
    deactivate: (id: string) => put<any>(`/api/users/${id}/deactivate`),
  },

  fintoc: {
    exchange: (exchangeToken: string) => post<any>('/api/fintoc/exchange', { exchange_token: exchangeToken }),
  },

  dashboard: () => get<any>('/api/dashboard'),
};
