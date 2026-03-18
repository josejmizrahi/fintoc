/**
 * Tests for GET and POST /api/invoices
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

// ── Mock: Supabase ──
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
      chain.order = vi.fn().mockImplementation(self);
      chain.range = vi.fn().mockImplementation(self);
      chain.limit = vi.fn().mockImplementation(self);

      chain.insert = vi.fn().mockImplementation(() => {
        const r = consumeResult(table);
        const insertChain: Record<string, unknown> = {};
        insertChain.select = vi.fn().mockReturnValue(insertChain);
        insertChain.single = vi.fn().mockImplementation(() => {
          const result = r as Record<string, unknown>;
          return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
        });
        return insertChain;
      });

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
const { GET, POST } = await import('./route');

// ── Helpers ──
function makeGetRequest(params = ''): Request {
  return new Request(`http://localhost/api/invoices${params ? '?' + params : ''}`, {
    method: 'GET',
  });
}

function makePostRequest(body: unknown): Request {
  return new Request('http://localhost/api/invoices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const routeCtx = { params: Promise.resolve({}) };

describe('GET /api/invoices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTableResults();
  });

  it('returns paginated invoices with defaults', async () => {
    const invoices = [
      { id: 1, invoice_number: 'FAC-001', type: 'receivable', amount_total: 5000 },
      { id: 2, invoice_number: 'FAC-002', type: 'payable', amount_total: 3000 },
    ];
    pushTableResult('invoices', { data: invoices, count: 2, error: null });

    const res = await GET(makeGetRequest(), routeCtx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(2);
    expect(json.meta.total).toBe(2);
    expect(json.meta.page).toBe(1);
    expect(json.meta.limit).toBe(25);
  });

  it('returns paginated invoices with custom page and limit', async () => {
    pushTableResult('invoices', { data: [], count: 50, error: null });

    const res = await GET(makeGetRequest('page=2&limit=10'), routeCtx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.meta.page).toBe(2);
    expect(json.meta.limit).toBe(10);
    expect(json.meta.total).toBe(50);
  });

  it('filters by type=payable', async () => {
    const payableInvoices = [
      { id: 1, type: 'payable', amount_total: 8000 },
    ];
    pushTableResult('invoices', { data: payableInvoices, count: 1, error: null });

    const res = await GET(makeGetRequest('type=payable'), routeCtx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].type).toBe('payable');
  });

  it('filters by type=receivable', async () => {
    const receivableInvoices = [
      { id: 2, type: 'receivable', amount_total: 3000 },
    ];
    pushTableResult('invoices', { data: receivableInvoices, count: 1, error: null });

    const res = await GET(makeGetRequest('type=receivable'), routeCtx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].type).toBe('receivable');
  });

  it('applies search filter', async () => {
    const matched = [{ id: 3, invoice_number: 'FAC-100', amount_total: 1500 }];
    pushTableResult('invoices', { data: matched, count: 1, error: null });

    const res = await GET(makeGetRequest('search=FAC-100'), routeCtx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(1);
  });

  it('returns empty array when no invoices match', async () => {
    pushTableResult('invoices', { data: [], count: 0, error: null });

    const res = await GET(makeGetRequest('type=payable&search=nonexistent'), routeCtx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual([]);
    expect(json.meta.total).toBe(0);
  });

  it('returns 500 on database error', async () => {
    pushTableResult('invoices', { data: null, count: null, error: { message: 'DB error' } });

    const res = await GET(makeGetRequest(), routeCtx);
    expect(res.status).toBe(500);
  });
});

describe('POST /api/invoices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTableResults();
  });

  it('creates an invoice successfully', async () => {
    const created = {
      id: 10,
      company_id: TEST_COMPANY_ID,
      type: 'receivable',
      invoice_number: 'FAC-NEW',
      amount_total: 5000,
      amount_paid: 0,
      amount_residual: 5000,
    };
    // insert result
    pushTableResult('invoices', { data: created, error: null });

    const res = await POST(
      makePostRequest({
        type: 'receivable',
        invoice_date: '2026-03-18',
        amount_total: 5000,
        currency: 'MXN',
        source: 'manual',
      }),
      routeCtx,
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.id).toBe(10);
    expect(json.data.type).toBe('receivable');
  });

  it('rejects duplicate UUID', async () => {
    // UUID uniqueness check returns an existing invoice
    pushTableResult('invoices', { data: { id: 99 } });

    const res = await POST(
      makePostRequest({
        type: 'payable',
        invoice_date: '2026-03-18',
        amount_total: 1000,
        currency: 'MXN',
        source: 'manual',
        uuid: 'abc-123-def',
      }),
      routeCtx,
    );

    expect(res.status).toBe(409);
  });

  it('returns 400 on invalid body', async () => {
    const res = await POST(
      makePostRequest({ type: 'invalid_type' }),
      routeCtx,
    );

    expect(res.status).toBe(400);
  });

  it('returns 500 on insert error', async () => {
    // No UUID check needed (no uuid in body)
    // insert fails
    pushTableResult('invoices', { data: null, error: { message: 'Insert failed' } });

    const res = await POST(
      makePostRequest({
        type: 'payable',
        invoice_date: '2026-03-18',
        amount_total: 2000,
        currency: 'MXN',
        source: 'manual',
      }),
      routeCtx,
    );

    expect(res.status).toBe(500);
  });
});
