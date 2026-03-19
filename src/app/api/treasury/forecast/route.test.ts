/**
 * Tests for GET /api/treasury/forecast
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const TEST_COMPANY_ID = 5;
const TEST_USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

// ── Mock: auth ──
vi.mock('@/lib/middleware/auth', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  withAuth: (handler: Function) => {
    return async (req: Request) => {
      const ctx = {
        user_id: TEST_USER_ID,
        company_id: TEST_COMPANY_ID,
        role: 'admin',
        email: 'test@quimibond.mx',
        supabase: {},
      };
      return handler(req, ctx);
    };
  },
}));

vi.mock('@/lib/middleware/rbac', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  withRbac: (_permission: string, handler: Function) => handler,
}));

vi.mock('@/lib/middleware/rate-limit', () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/middleware/audit', () => ({
  writeAuditLog: vi.fn(),
}));

// ── Mock: Supabase with per-table result queues ──
const tableQueues: Record<string, Array<unknown>> = {};

function pushTableResult(table: string, result: unknown) {
  if (!tableQueues[table]) tableQueues[table] = [];
  tableQueues[table].push(result);
}

function clearTableResults() {
  for (const key of Object.keys(tableQueues)) {
    delete tableQueues[key];
  }
}

function consumeResult(table: string): unknown {
  const queue = tableQueues[table];
  if (queue && queue.length > 0) return queue.shift();
  return { data: null, error: null };
}

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      let resolved = false;

      const chain: Record<string, unknown> = {};
      const self = (): typeof chain => chain;

      chain.select = vi.fn().mockImplementation(self);
      chain.eq = vi.fn().mockImplementation(self);
      chain.gt = vi.fn().mockImplementation(self);
      chain.in = vi.fn().mockImplementation(self);
      chain.not = vi.fn().mockImplementation(self);
      chain.order = vi.fn().mockImplementation(self);
      chain.limit = vi.fn().mockImplementation(self);

      chain.single = vi.fn().mockImplementation(() => {
        return Promise.resolve(consumeResult(table));
      });

      Object.defineProperty(chain, 'then', {
        get() {
          if (!resolved) {
            resolved = true;
            const p = Promise.resolve(consumeResult(table));
            return p.then.bind(p);
          }
          return undefined;
        },
        configurable: true,
      });

      return chain;
    },
  }),
}));

// ── Import route ──
const { GET } = await import('./route');

// ── Helpers ──
function makeRequest(days?: number): Request {
  const url = days
    ? `http://localhost/api/treasury/forecast?days=${days}`
    : 'http://localhost/api/treasury/forecast';
  return new Request(url, { method: 'GET' });
}

describe('GET /api/treasury/forecast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTableResults();
  });

  it('returns forecast with default 30 days', async () => {
    // companies: config
    pushTableResult('companies', { data: { config: {} } });
    // bank_accounts: balance
    pushTableResult('bank_accounts', { data: [{ balance: 100000 }] });
    // payments: scheduled
    pushTableResult('payments', { data: [] });
    // invoices: receivables
    pushTableResult('invoices', { data: [] });
    // expenses: committed
    pushTableResult('expenses', { data: [] });

    const res = await GET(makeRequest(), { params: Promise.resolve({}) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(30);
    expect(json.meta.current_balance).toBe(100000);
    expect(json.meta.committed_expenses).toBe(0);
  });

  it('respects custom days parameter', async () => {
    pushTableResult('companies', { data: { config: {} } });
    pushTableResult('bank_accounts', { data: [] });
    pushTableResult('payments', { data: [] });
    pushTableResult('invoices', { data: [] });
    pushTableResult('expenses', { data: [] });

    const res = await GET(makeRequest(7), { params: Promise.resolve({}) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(7);
  });

  it('caps days at 365', async () => {
    pushTableResult('companies', { data: { config: {} } });
    pushTableResult('bank_accounts', { data: [] });
    pushTableResult('payments', { data: [] });
    pushTableResult('invoices', { data: [] });
    pushTableResult('expenses', { data: [] });

    const res = await GET(makeRequest(999), { params: Promise.resolve({}) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(365);
  });

  it('uses company config for collection rates', async () => {
    pushTableResult('companies', {
      data: { config: { forecast_collection_rate: 0.5, forecast_pessimistic_rate: 0.2 } },
    });
    pushTableResult('bank_accounts', { data: [{ balance: 10000 }] });
    pushTableResult('payments', { data: [] });
    pushTableResult('invoices', { data: [] });
    pushTableResult('expenses', { data: [] });

    const res = await GET(makeRequest(1), { params: Promise.resolve({}) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.meta.collection_rates.base).toBe(0.5);
    expect(json.meta.collection_rates.pessimistic).toBe(0.2);
    expect(json.meta.collection_rates.optimistic).toBe(1.0);
  });

  it('uses default collection rates when no company config', async () => {
    pushTableResult('companies', { data: null });
    pushTableResult('bank_accounts', { data: [] });
    pushTableResult('payments', { data: [] });
    pushTableResult('invoices', { data: [] });
    pushTableResult('expenses', { data: [] });

    const res = await GET(makeRequest(1), { params: Promise.resolve({}) });
    const json = await res.json();

    expect(json.meta.collection_rates.base).toBe(0.7);
    expect(json.meta.collection_rates.pessimistic).toBe(0);
  });

  it('subtracts committed expenses from starting balance', async () => {
    pushTableResult('companies', { data: { config: {} } });
    pushTableResult('bank_accounts', { data: [{ balance: 50000 }] });
    pushTableResult('payments', { data: [] });
    pushTableResult('invoices', { data: [] });
    pushTableResult('expenses', { data: [{ amount: 10000 }, { amount: 5000 }] });

    const res = await GET(makeRequest(1), { params: Promise.resolve({}) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.meta.committed_expenses).toBe(15000);
    expect(json.meta.current_balance).toBe(50000);
    // First day balance should be currentBalance - committedExpenses = 35000
    expect(json.data[0].optimistic).toBe(35000);
    expect(json.data[0].base).toBe(35000);
    expect(json.data[0].pessimistic).toBe(35000);
  });

  it('sums balances from multiple bank accounts', async () => {
    pushTableResult('companies', { data: { config: {} } });
    pushTableResult('bank_accounts', {
      data: [{ balance: 20000 }, { balance: 30000 }, { balance: 5000 }],
    });
    pushTableResult('payments', { data: [] });
    pushTableResult('invoices', { data: [] });
    pushTableResult('expenses', { data: [] });

    const res = await GET(makeRequest(1), { params: Promise.resolve({}) });
    const json = await res.json();

    expect(json.meta.current_balance).toBe(55000);
    expect(json.data[0].optimistic).toBe(55000);
  });

  it('applies scheduled payments as outflows on the correct day', async () => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    pushTableResult('companies', { data: { config: {} } });
    pushTableResult('bank_accounts', { data: [{ balance: 100000 }] });
    pushTableResult('payments', {
      data: [{ amount: 25000, scheduled_date: tomorrowStr }],
    });
    pushTableResult('invoices', { data: [] });
    pushTableResult('expenses', { data: [] });

    const res = await GET(makeRequest(3), { params: Promise.resolve({}) });
    const json = await res.json();

    // Day 0: 100000 (no payments today)
    expect(json.data[0].optimistic).toBe(100000);
    // Day 1: 100000 - 25000 = 75000
    expect(json.data[1].optimistic).toBe(75000);
    // Day 2: still 75000 (no more payments)
    expect(json.data[2].optimistic).toBe(75000);
  });

  it('applies receivables as inflows with collection rates', async () => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    pushTableResult('companies', {
      data: { config: { forecast_collection_rate: 0.5, forecast_pessimistic_rate: 0 } },
    });
    pushTableResult('bank_accounts', { data: [{ balance: 10000 }] });
    pushTableResult('payments', { data: [] });
    pushTableResult('invoices', {
      data: [{ amount_residual: 20000, due_date: todayStr }],
    });
    pushTableResult('expenses', { data: [] });

    const res = await GET(makeRequest(1), { params: Promise.resolve({}) });
    const json = await res.json();

    // Optimistic: 10000 + 20000 = 30000
    expect(json.data[0].optimistic).toBe(30000);
    // Base: 10000 + (20000 * 0.5) = 20000
    expect(json.data[0].base).toBe(20000);
    // Pessimistic: 10000 + (20000 * 0) = 10000
    expect(json.data[0].pessimistic).toBe(10000);
  });
});
