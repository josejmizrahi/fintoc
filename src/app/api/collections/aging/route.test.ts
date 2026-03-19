/**
 * Tests for GET /api/collections/aging
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
      chain.lt = vi.fn().mockImplementation(self);
      chain.or = vi.fn().mockImplementation(self);
      chain.in = vi.fn().mockImplementation(self);
      chain.not = vi.fn().mockImplementation(self);
      chain.order = vi.fn().mockImplementation(self);
      chain.range = vi.fn().mockImplementation(self);
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
function makeRequest(): Request {
  return new Request('http://localhost/api/collections/aging', { method: 'GET' });
}

const routeCtx = { params: Promise.resolve({}) };

/** Helper to create a date string N days in the past from today */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

describe('GET /api/collections/aging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTableResults();
  });

  it('returns empty buckets when no receivable invoices exist', async () => {
    pushTableResult('invoices', { data: [] });

    const res = await GET(makeRequest(), routeCtx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.buckets).toEqual([
      { range: '0-30', amount: 0, count: 0 },
      { range: '31-60', amount: 0, count: 0 },
      { range: '61-90', amount: 0, count: 0 },
      { range: '90+', amount: 0, count: 0 },
    ]);
    expect(json.data.by_customer).toEqual([]);
  });

  it('returns empty buckets when invoices query returns null', async () => {
    pushTableResult('invoices', { data: null });

    const res = await GET(makeRequest(), routeCtx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.buckets[0].count).toBe(0);
    expect(json.data.buckets[1].count).toBe(0);
    expect(json.data.buckets[2].count).toBe(0);
    expect(json.data.buckets[3].count).toBe(0);
    expect(json.data.by_customer).toEqual([]);
  });

  it('places invoices in the 0-30 day bucket', async () => {
    pushTableResult('invoices', {
      data: [
        {
          id: 1,
          customer_id: 'cust-1',
          customers: { name: 'Cliente A' },
          amount_residual: 5000,
          due_date: daysAgo(10),
        },
        {
          id: 2,
          customer_id: 'cust-1',
          customers: { name: 'Cliente A' },
          amount_residual: 3000,
          due_date: daysAgo(25),
        },
      ],
    });

    const res = await GET(makeRequest(), routeCtx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.buckets[0]).toEqual({ range: '0-30', amount: 8000, count: 2 });
    expect(json.data.buckets[1].count).toBe(0);
    expect(json.data.buckets[2].count).toBe(0);
    expect(json.data.buckets[3].count).toBe(0);
  });

  it('places invoices in the 31-60 day bucket', async () => {
    pushTableResult('invoices', {
      data: [
        {
          id: 3,
          customer_id: 'cust-2',
          customers: { name: 'Cliente B' },
          amount_residual: 12000,
          due_date: daysAgo(45),
        },
      ],
    });

    const res = await GET(makeRequest(), routeCtx);
    const json = await res.json();

    expect(json.data.buckets[0].count).toBe(0);
    expect(json.data.buckets[1]).toEqual({ range: '31-60', amount: 12000, count: 1 });
  });

  it('places invoices in the 61-90 day bucket', async () => {
    pushTableResult('invoices', {
      data: [
        {
          id: 4,
          customer_id: 'cust-3',
          customers: { name: 'Cliente C' },
          amount_residual: 7500,
          due_date: daysAgo(75),
        },
      ],
    });

    const res = await GET(makeRequest(), routeCtx);
    const json = await res.json();

    expect(json.data.buckets[2]).toEqual({ range: '61-90', amount: 7500, count: 1 });
  });

  it('places invoices in the 90+ day bucket', async () => {
    pushTableResult('invoices', {
      data: [
        {
          id: 5,
          customer_id: 'cust-4',
          customers: { name: 'Cliente D' },
          amount_residual: 20000,
          due_date: daysAgo(120),
        },
      ],
    });

    const res = await GET(makeRequest(), routeCtx);
    const json = await res.json();

    expect(json.data.buckets[3]).toEqual({ range: '90+', amount: 20000, count: 1 });
  });

  it('distributes invoices across multiple buckets correctly', async () => {
    pushTableResult('invoices', {
      data: [
        {
          id: 10,
          customer_id: 'cust-A',
          customers: { name: 'Alpha' },
          amount_residual: 1000,
          due_date: daysAgo(5),
        },
        {
          id: 11,
          customer_id: 'cust-B',
          customers: { name: 'Beta' },
          amount_residual: 2000,
          due_date: daysAgo(40),
        },
        {
          id: 12,
          customer_id: 'cust-C',
          customers: { name: 'Gamma' },
          amount_residual: 3000,
          due_date: daysAgo(80),
        },
        {
          id: 13,
          customer_id: 'cust-D',
          customers: { name: 'Delta' },
          amount_residual: 4000,
          due_date: daysAgo(100),
        },
      ],
    });

    const res = await GET(makeRequest(), routeCtx);
    const json = await res.json();

    expect(json.data.buckets[0]).toEqual({ range: '0-30', amount: 1000, count: 1 });
    expect(json.data.buckets[1]).toEqual({ range: '31-60', amount: 2000, count: 1 });
    expect(json.data.buckets[2]).toEqual({ range: '61-90', amount: 3000, count: 1 });
    expect(json.data.buckets[3]).toEqual({ range: '90+', amount: 4000, count: 1 });
  });

  it('groups invoices by customer and sorts by total descending', async () => {
    pushTableResult('invoices', {
      data: [
        {
          id: 20,
          customer_id: 'cust-small',
          customers: { name: 'Small Co' },
          amount_residual: 1000,
          due_date: daysAgo(10),
        },
        {
          id: 21,
          customer_id: 'cust-big',
          customers: { name: 'Big Corp' },
          amount_residual: 15000,
          due_date: daysAgo(50),
        },
        {
          id: 22,
          customer_id: 'cust-big',
          customers: { name: 'Big Corp' },
          amount_residual: 5000,
          due_date: daysAgo(20),
        },
      ],
    });

    const res = await GET(makeRequest(), routeCtx);
    const json = await res.json();

    expect(json.data.by_customer).toHaveLength(2);
    // Big Corp should be first (total=20000), Small Co second (total=1000)
    expect(json.data.by_customer[0].customer_id).toBe('cust-big');
    expect(json.data.by_customer[0].name).toBe('Big Corp');
    expect(json.data.by_customer[0].total).toBe(20000);
    expect(json.data.by_customer[0].invoices).toHaveLength(2);

    expect(json.data.by_customer[1].customer_id).toBe('cust-small');
    expect(json.data.by_customer[1].total).toBe(1000);
    expect(json.data.by_customer[1].invoices).toHaveLength(1);
  });

  it('handles invoice with no customer (falls back to "unknown" and "Sin cliente")', async () => {
    pushTableResult('invoices', {
      data: [
        {
          id: 30,
          customer_id: null,
          customers: null,
          amount_residual: 2500,
          due_date: daysAgo(15),
        },
      ],
    });

    const res = await GET(makeRequest(), routeCtx);
    const json = await res.json();

    expect(json.data.by_customer).toHaveLength(1);
    expect(json.data.by_customer[0].customer_id).toBe('unknown');
    expect(json.data.by_customer[0].name).toBe('Sin cliente');
    expect(json.data.by_customer[0].total).toBe(2500);
  });

  it('treats invoices with no due_date as 0 days old (0-30 bucket)', async () => {
    pushTableResult('invoices', {
      data: [
        {
          id: 40,
          customer_id: 'cust-x',
          customers: { name: 'No Due Date Co' },
          amount_residual: 6000,
          due_date: null,
        },
      ],
    });

    const res = await GET(makeRequest(), routeCtx);
    const json = await res.json();

    // No due_date means daysOld = 0, which falls in 0-30 bucket
    expect(json.data.buckets[0]).toEqual({ range: '0-30', amount: 6000, count: 1 });
    expect(json.data.buckets[1].count).toBe(0);
  });
});
