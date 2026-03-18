/* eslint-disable @typescript-eslint/no-explicit-any -- API client uses `any` for untyped endpoint responses */
import type { Payment, Invoice, Vendor, Customer, Expense, Budget, Notification } from '@/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

function getHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json' };
}

// Prevent multiple concurrent 401 handlers from all triggering redirects
let isRedirectingTo401 = false;

// Deduplicate concurrent refresh attempts
let refreshPromise: Promise<boolean> | null = null;

/**
 * Try to refresh the session via httpOnly cookie.
 * The refresh token is sent automatically as a cookie — no JS access needed.
 * Returns true on success, false on failure.
 */
async function tryRefreshToken(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      return res.ok;
    } catch {
      return false;
    }
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  let res = await fetch(`${API_BASE}${url}`, {
    ...options,
    credentials: 'same-origin',
    headers: { ...getHeaders(), ...options?.headers },
  });

  // On 401, attempt a single token refresh before giving up
  if (res.status === 401 && !url.includes('/api/auth/refresh')) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      res = await fetch(`${API_BASE}${url}`, {
        ...options,
        credentials: 'same-origin',
        headers: { ...getHeaders(), ...options?.headers },
      });
    }
  }

  if (res.status === 401) {
    const detail = await res.json().catch(() => ({}));
    const debugMsg = `401 en ${url}: ${detail?.error?.message || detail?.detail || JSON.stringify(detail)}`;
    console.warn('[API 401]', debugMsg);
    if (typeof window !== 'undefined' && !isRedirectingTo401) {
      isRedirectingTo401 = true;
      sessionStorage.setItem('auth_debug', debugMsg);
      // Clear server-side cookies + client-side UI state
      fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'same-origin' }).catch(() => {});
      const { useAuthStore } = await import('@/lib/store');
      useAuthStore.getState().logout();
      setTimeout(() => {
        if (window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
        isRedirectingTo401 = false;
      }, 500);
    }
    throw new ApiError(401, debugMsg);
  }

  if (res.status === 403) {
    throw new ApiError(403, 'No tienes permisos para esta accion');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = body.error?.message || body.detail || (typeof body.error === 'string' ? body.error : `Error ${res.status}`);
    throw new ApiError(res.status, message, body.error?.code);
  }

  return res.json();
}

async function authRequest<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ detail: res.statusText }));
    let message = data.error?.message || data.detail || data.message || (typeof data.error === 'string' ? data.error : `Error ${res.status}`);
    const fields = data.error?.details?.fields;
    if (Array.isArray(fields) && fields.length > 0) {
      message += ': ' + fields.map((f: { path?: string; message?: string }) => `${f.path}: ${f.message}`).join(', ');
    }
    throw new ApiError(res.status, message, data.error?.code);
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
    register: (data: { email: string; password: string; full_name?: string; company_name: string; rfc: string }) =>
      authRequest<any>('/api/auth/register', data),
    login: (data: { email: string; password: string }) =>
      authRequest<any>('/api/auth/login', data),
    me: () => get<any>('/api/auth/me'),
    resetPassword: (data: { email: string }) =>
      authRequest<any>('/api/auth/reset-password', data),
    updatePassword: (data: { password: string }) =>
      authRequest<{ message: string }>('/api/auth/update-password', data),
    switchCompany: async (data: { company_id: string | number }) => {
      // Tokens are handled via httpOnly cookies automatically
      const res = await request<any>('/api/auth/switch-company', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      return res?.data || res;
    },
    logout: () => authRequest<{ ok: boolean }>('/api/auth/logout', {}),
  },

  payments: {
    list: (params?: Record<string, unknown>) => get<PaginatedResponse<Payment>>('/api/payments', params),
    get: (id: string) => get<{ data: Payment }>(`/api/payments/${id}`),
    create: (data: Record<string, unknown>) => post<{ data: Payment }>('/api/payments', data),
    execute: (data: { payment_id: string }) => post<{ data: Payment }>('/api/payments/execute', data),
    executeBatch: (data: { payment_ids: string[] }) => post<any>('/api/payments/execute-batch', data),
    cancel: (id: string) => post<{ data: Payment }>(`/api/payments/${id}/cancel`),
    retry: (id: string) => post<{ data: Payment }>(`/api/payments/${id}/retry`),
    pollStatus: (id: string) => post<{ data: Payment }>(`/api/payments/${id}/poll-status`),
    scheduled: () => get<{ data: Payment[] }>('/api/payments/scheduled/list'),
  },

  invoices: {
    list: (params?: Record<string, unknown>) => get<PaginatedResponse<Invoice>>('/api/invoices', params),
    payable: (params?: Record<string, unknown>) => get<PaginatedResponse<Invoice>>('/api/invoices/payable', params),
    receivable: (params?: Record<string, unknown>) => get<PaginatedResponse<Invoice>>('/api/invoices/receivable', params),
    get: (id: string) => get<{ data: Invoice }>(`/api/invoices/${id}`),
    cfdi: (id: string) => get<any>(`/api/invoices/${id}/cfdi`),
    overdueReceivable: (days?: number) => get<Invoice[]>('/api/invoices/overdue/receivable', { days }),
    overduePayable: (days?: number) => get<Invoice[]>('/api/invoices/overdue/payable', { days }),
    payableSummary: () => get<any>('/api/invoices/payable-summary'),
  },

  vendors: {
    list: (params?: Record<string, unknown>) => get<PaginatedResponse<Vendor>>('/api/vendors', params),
    get: (id: string) => get<{ data: Vendor }>(`/api/vendors/${id}`),
    create: (data: Record<string, unknown>) => post<{ data: Vendor }>('/api/vendors', data),
    update: (id: string, data: Record<string, unknown>) => put<{ data: Vendor }>(`/api/vendors/${id}`, data),
    verifyClabe: (id: string) => post<any>(`/api/vendors/${id}/verify-clabe`),
    bills: (id: string) => get<Invoice[]>(`/api/vendors/${id}/bills`),
  },

  customers: {
    list: (params?: Record<string, unknown>) => get<PaginatedResponse<Customer>>('/api/customers', params),
    get: (id: string) => get<{ data: Customer }>(`/api/customers/${id}`),
    create: (data: Record<string, unknown>) => post<{ data: Customer }>('/api/customers', data),
    update: (id: string, data: Record<string, unknown>) => put<{ data: Customer }>(`/api/customers/${id}`, data),
    createClabe: (id: string) => post<any>(`/api/customers/${id}/create-clabe`),
    invoices: (id: string) => get<Invoice[]>(`/api/customers/${id}/invoices`),
    search: (q: string) => get<Customer[]>('/api/customers/search', { q }),
  },

  collections: {
    pending: (params?: Record<string, unknown>) => get<any>('/api/collections/pending', params),
    overdue: (params?: Record<string, unknown>) => get<any>('/api/collections/overdue', params),
    aging: () => get<any>('/api/collections/aging'),
    paymentLink: (data: Record<string, unknown>) => post<any>('/api/collections/payment-links', data),
    sendReminder: (data: Record<string, unknown>) => post<any>('/api/collections/send-reminder', data),
    summary: () => get<any>('/api/collections/summary'),
    overdueSummary: () => get<any>('/api/collections/overdue-summary'),
  },

  expenses: {
    list: (params?: Record<string, unknown>) => get<PaginatedResponse<Expense>>('/api/expenses', params),
    create: (data: Record<string, unknown>) => post<{ data: Expense }>('/api/expenses', data),
    update: (id: string, data: Record<string, unknown>) => put<{ data: Expense }>(`/api/expenses/${id}`, data),
    approve: (id: string) => post<{ data: Expense }>(`/api/expenses/${id}/approve`),
    reject: (id: string, reason: string) => post<{ data: Expense }>(`/api/expenses/${id}/reject`, { reason }),
    summary: () => get<any>('/api/expenses/summary'),
  },

  treasury: {
    snapshot: () => get<any>('/api/treasury/snapshot'),
    forecast: (days?: number) => get<any>('/api/treasury/forecast', { days }),
    movements: (params?: Record<string, unknown>) => get<any>('/api/treasury/movements', params),
    balance: () => get<any>('/api/treasury/balance'),
    accounts: () => get<any>('/api/treasury/accounts'),
  },

  budgets: {
    list: () => get<{ data: Budget[] }>('/api/budgets'),
    get: (id: string) => get<{ data: Budget }>(`/api/budgets/${id}`),
    create: (data: Record<string, unknown>) => post<{ data: Budget }>('/api/budgets', data),
    vsActual: () => get<any>('/api/budgets/vs-actual'),
  },

  approvals: {
    rules: () => get<{ data: any[] }>('/api/approvals/rules'),
    createRule: (data: Record<string, unknown>) => post<any>('/api/approvals/rules', data),
    pending: (params?: Record<string, unknown>) => get<any[]>('/api/approvals/pending', params),
    approve: (id: string) => post<any>(`/api/approvals/${id}/approve`),
    reject: (id: string, reason: string) => post<any>(`/api/approvals/${id}/reject`, { reason }),
  },

  sat: {
    validate: (data: Record<string, unknown>) => post<any>('/api/sat/validate', data),
    validateRfc: (data: Record<string, unknown>) => post<any>('/api/sat/validate-rfc', data),
    checkEfos: (data: Record<string, unknown>) => post<any>('/api/sat/check-efos', data),
    cancel: (data: Record<string, unknown>) => post<any>('/api/sat/cancel', data),
    upload: (data: Record<string, unknown>) => post<any>('/api/sat/upload', data),

    // ── Syntage (sat.ws) ──
    syntage: {
      status: () => get<any>('/api/sat/syntage', { action: 'status' }),
      taxpayers: () => get<any>('/api/sat/syntage', { action: 'taxpayers' }),
      invoices: (taxpayerId: string, params?: Record<string, unknown>) =>
        get<any>('/api/sat/syntage', { action: 'invoices', taxpayerId, ...params }),
      invoiceCfdi: (id: string) => get<any>('/api/sat/syntage', { action: 'invoice-cfdi', id }),
      taxReturns: (taxpayerId: string) => get<any>('/api/sat/syntage', { action: 'tax-returns', taxpayerId }),
      taxCompliance: (taxpayerId: string) => get<any>('/api/sat/syntage', { action: 'tax-compliance', taxpayerId }),
      taxStatus: (taxpayerId: string) => get<any>('/api/sat/syntage', { action: 'tax-status', taxpayerId }),
      taxRetentions: (taxpayerId: string) => get<any>('/api/sat/syntage', { action: 'tax-retentions', taxpayerId }),
      extractions: () => get<any>('/api/sat/syntage', { action: 'extractions' }),
      saveConfig: (data: { syntageApiKey: string; syntageEnvironment?: string; rfcEmisor?: string }) =>
        post<any>('/api/sat/syntage', { action: 'save-config', ...data }),
      extract: (taxpayerId: string, extractor?: string, options?: { period?: { from: string; to: string }; issued?: boolean; received?: boolean }) =>
        post<any>('/api/sat/syntage', { action: 'extract', taxpayerId, extractor, options }),
      stopExtraction: (extractionId: string) =>
        post<any>('/api/sat/syntage', { action: 'stop-extraction', extractionId }),
    },
  },

  reconciliation: {
    satOdoo: (data: Record<string, unknown>) => post<any>('/api/reconciliation/sat-odoo', data),
    satApp: (data: Record<string, unknown>) => post<any>('/api/reconciliation/sat-app', data),
    bancoApp: (data: Record<string, unknown>) => post<any>('/api/reconciliation/banco-app', data),
    history: () => get<any[]>('/api/reconciliation/history'),
    importToOdoo: (data: Record<string, unknown>) => post<any>('/api/reconciliation/import-to-odoo', data),
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
    list: (params?: Record<string, unknown>) => get<Notification[]>('/api/notifications', params),
    markRead: (ids: string[]) => post<any>('/api/notifications/mark-read', { notification_ids: ids }),
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
    trigger: (provider: string) => post<any>('/api/v2/sync', { provider }),
    status: () => get<any>('/api/v2/sync'),
    logs: () => get<any[]>('/api/sync-logs'),
    odooPartners: () => post<any>('/api/sync/odoo/partners'),
  },

  audit: {
    list: (params?: Record<string, unknown>) => get<any[]>('/api/audit', params),
    forEntity: (entityType: string, entityId: string) =>
      get<any[]>('/api/audit', { entity_type: entityType, entity_id: entityId }),
  },

  search: (q: string) => get<any>('/api/search', { q }),

  companies: {
    list: () => get<any[]>('/api/companies'),
    get: (id: string) => get<any>(`/api/companies/${id}`),
    create: (data: Record<string, unknown>) => post<any>('/api/companies', data),
  },

  users: {
    list: () => get<any[]>('/api/users'),
    invite: (data: Record<string, unknown>) => post<any>('/api/users/invite', data),
    updateRole: (id: string, role: string) => put<Record<string, unknown>>(`/api/users/${id}/role`, { role }),
    deactivate: (id: string) => put<Record<string, unknown>>(`/api/users/${id}/deactivate`),
  },

  fintoc: {
    exchange: (exchangeToken: string) => post<any>('/api/fintoc/exchange', { exchange_token: exchangeToken }),
  },

  dashboard: () => get<any>('/api/dashboard'),
  dashboardIntegrations: () => get<any>('/api/dashboard/integrations'),
};
