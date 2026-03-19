/**
 * Tests for GET and POST /api/payments
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
      chain.neq = vi.fn().mockImplementation(self);
      chain.gt = vi.fn().mockImplementation(self);
      chain.lt = vi.fn().mockImplementation(self);
      chain.gte = vi.fn().mockImplementation(self);
      chain.lte = vi.fn().mockImplementation(self);
      chain.or = vi.fn().mockImplementation(self);
      chain.in = vi.fn().mockImplementation(self);
      chain.not = vi.fn().mockImplementation(self);
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
        // Make insert chain awaitable for fire-and-forget pattern (notifications)
        insertChain.then = (
          resolve: (v: unknown) => void,
          reject?: (e: unknown) => void,
        ) => Promise.resolve(r).then(resolve, reject);
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
  return new Request(`http://localhost/api/payments${params ? '?' + params : ''}`, {
    method: 'GET',
  });
}

function makePostRequest(body: unknown): Request {
  return new Request('http://localhost/api/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const routeCtx = { params: Promise.resolve({}) };

// A valid vendor object used across POST tests
const VALID_VENDOR = {
  id: 1,
  name: 'Proveedor Test',
  rfc: 'XAXX010101000',
  clabe: '012345678901234567',
  efos_status: null,
};

describe('GET /api/payments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTableResults();
  });

  it('returns paginated payments with defaults', async () => {
    const payments = [
      { id: 1, amount: 5000, status: 'draft', beneficiary_name: 'Vendor A' },
      { id: 2, amount: 3000, status: 'pending', beneficiary_name: 'Vendor B' },
    ];
    pushTableResult('payments', { data: payments, count: 2, error: null });

    const res = await GET(makeGetRequest(), routeCtx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(2);
    expect(json.meta.total).toBe(2);
    expect(json.meta.page).toBe(1);
    expect(json.meta.limit).toBe(25);
  });

  it('returns paginated payments with custom page and limit', async () => {
    pushTableResult('payments', { data: [], count: 100, error: null });

    const res = await GET(makeGetRequest('page=3&limit=10'), routeCtx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.meta.page).toBe(3);
    expect(json.meta.limit).toBe(10);
    expect(json.meta.total).toBe(100);
  });

  it('filters by status', async () => {
    const pending = [{ id: 1, amount: 5000, status: 'pending', beneficiary_name: 'V' }];
    pushTableResult('payments', { data: pending, count: 1, error: null });

    const res = await GET(makeGetRequest('status=pending'), routeCtx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(1);
  });

  it('filters by multiple statuses (comma-separated)', async () => {
    const mixed = [
      { id: 1, amount: 5000, status: 'draft', beneficiary_name: 'V1' },
      { id: 2, amount: 3000, status: 'pending', beneficiary_name: 'V2' },
    ];
    pushTableResult('payments', { data: mixed, count: 2, error: null });

    const res = await GET(makeGetRequest('status=draft,pending'), routeCtx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(2);
  });

  it('filters by vendor_id', async () => {
    pushTableResult('payments', { data: [{ id: 1, vendor_id: 42 }], count: 1, error: null });

    const res = await GET(makeGetRequest('vendor_id=42'), routeCtx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(1);
  });

  it('applies search filter', async () => {
    const matched = [{ id: 1, concept: 'Renta oficina', beneficiary_name: 'V' }];
    pushTableResult('payments', { data: matched, count: 1, error: null });

    const res = await GET(makeGetRequest('search=Renta'), routeCtx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(1);
  });

  it('maps beneficiary_name to partner_name for frontend compatibility', async () => {
    const payments = [
      { id: 1, beneficiary_name: 'My Vendor', partner_name: null },
    ];
    pushTableResult('payments', { data: payments, count: 1, error: null });

    const res = await GET(makeGetRequest(), routeCtx);
    const json = await res.json();

    expect(json.data[0].partner_name).toBe('My Vendor');
  });

  it('preserves existing partner_name if already set', async () => {
    const payments = [
      { id: 1, beneficiary_name: 'Fallback', partner_name: 'Original Partner' },
    ];
    pushTableResult('payments', { data: payments, count: 1, error: null });

    const res = await GET(makeGetRequest(), routeCtx);
    const json = await res.json();

    expect(json.data[0].partner_name).toBe('Original Partner');
  });

  it('returns empty array when no payments match', async () => {
    pushTableResult('payments', { data: [], count: 0, error: null });

    const res = await GET(makeGetRequest('status=cancelled'), routeCtx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual([]);
    expect(json.meta.total).toBe(0);
  });

  it('returns 500 on database error', async () => {
    pushTableResult('payments', { data: null, count: null, error: { message: 'DB error' } });

    const res = await GET(makeGetRequest(), routeCtx);
    expect(res.status).toBe(500);
  });
});

describe('POST /api/payments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTableResults();
  });

  it('creates a payment successfully (no approval needed)', async () => {
    const createdPayment = {
      id: 100,
      company_id: TEST_COMPANY_ID,
      amount: 5000,
      status: 'draft',
      vendor_id: 1,
      beneficiary_name: 'Proveedor Test',
    };

    // 1. Vendor lookup
    pushTableResult('vendors', { data: VALID_VENDOR, error: null });
    // 2. Approval rules query (no rules)
    pushTableResult('approval_rules', { data: [] });
    // 3. Payment insert
    pushTableResult('payments', { data: createdPayment, error: null });

    const res = await POST(
      makePostRequest({
        vendor_id: 1,
        amount: 5000,
        concept: 'Pago de servicios',
      }),
      routeCtx,
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.id).toBe(100);
    expect(json.data.status).toBe('draft');
    expect(json.data.approval_request).toBeNull();
  });

  it('creates a scheduled payment', async () => {
    const createdPayment = {
      id: 101,
      company_id: TEST_COMPANY_ID,
      amount: 3000,
      status: 'scheduled',
      vendor_id: 1,
      scheduled_date: '2026-04-01',
    };

    pushTableResult('vendors', { data: VALID_VENDOR, error: null });
    pushTableResult('approval_rules', { data: [] });
    pushTableResult('payments', { data: createdPayment, error: null });

    const res = await POST(
      makePostRequest({
        vendor_id: 1,
        amount: 3000,
        concept: 'Renta',
        scheduled_date: '2026-04-01',
      }),
      routeCtx,
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.status).toBe('scheduled');
  });

  it('blocks payment when vendor has EFOS definitivo status', async () => {
    const efosVendor = { ...VALID_VENDOR, efos_status: 'definitivo' };
    pushTableResult('vendors', { data: efosVendor, error: null });

    const res = await POST(
      makePostRequest({
        vendor_id: 1,
        amount: 5000,
        concept: 'Pago bloqueado',
      }),
      routeCtx,
    );
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe('VENDOR_EFOS_BLOCKED');
  });

  it('rejects payment when vendor has no CLABE', async () => {
    const noClabeVendor = { ...VALID_VENDOR, clabe: null };
    pushTableResult('vendors', { data: noClabeVendor, error: null });

    const res = await POST(
      makePostRequest({
        vendor_id: 1,
        amount: 2000,
        concept: 'Sin CLABE',
      }),
      routeCtx,
    );
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe('VENDOR_NO_CLABE');
  });

  it('returns 404 when vendor is not found', async () => {
    pushTableResult('vendors', { data: null, error: { message: 'Not found' } });

    const res = await POST(
      makePostRequest({
        vendor_id: 999,
        amount: 1000,
        concept: 'No vendor',
      }),
      routeCtx,
    );

    expect(res.status).toBe(404);
  });

  it('sets status to pending_approval when matching approval rule exists', async () => {
    const createdPayment = {
      id: 102,
      company_id: TEST_COMPANY_ID,
      amount: 50000,
      status: 'pending_approval',
      vendor_id: 1,
    };
    const approvalRequest = {
      id: 'apr-1',
      entity_type: 'payment',
      entity_id: 102,
      status: 'pending',
    };

    // 1. Vendor lookup
    pushTableResult('vendors', { data: VALID_VENDOR, error: null });
    // 2. Approval rules — one matching rule that requires approval
    pushTableResult('approval_rules', {
      data: [
        {
          id: 'rule-1',
          amount_min: 10000,
          amount_max: 100000,
          auto_approve: false,
          approvers: ['approver-user-1', 'approver-user-2'],
          is_active: true,
        },
      ],
    });
    // 3. Payment insert
    pushTableResult('payments', { data: createdPayment, error: null });
    // 4. Approval request insert
    pushTableResult('approval_requests', { data: approvalRequest, error: null });
    // 5. Notification inserts for each approver (2 approvers)
    pushTableResult('notifications', { data: null, error: null });
    pushTableResult('notifications', { data: null, error: null });

    const res = await POST(
      makePostRequest({
        vendor_id: 1,
        amount: 50000,
        concept: 'Pago grande',
      }),
      routeCtx,
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.status).toBe('pending_approval');
    expect(json.data.approval_request).toBeTruthy();
    expect(json.data.approval_request.entity_type).toBe('payment');
  });

  it('does not require approval when rule has auto_approve=true', async () => {
    const createdPayment = {
      id: 103,
      company_id: TEST_COMPANY_ID,
      amount: 50000,
      status: 'draft',
      vendor_id: 1,
    };

    pushTableResult('vendors', { data: VALID_VENDOR, error: null });
    pushTableResult('approval_rules', {
      data: [
        {
          id: 'rule-auto',
          amount_min: 0,
          amount_max: null,
          auto_approve: true,
          approvers: [],
          is_active: true,
        },
      ],
    });
    pushTableResult('payments', { data: createdPayment, error: null });

    const res = await POST(
      makePostRequest({
        vendor_id: 1,
        amount: 50000,
        concept: 'Auto approved',
      }),
      routeCtx,
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.status).toBe('draft');
    expect(json.data.approval_request).toBeNull();
  });

  it('uses invoice amount_residual when no amount is explicitly provided', async () => {
    const createdPayment = {
      id: 104,
      company_id: TEST_COMPANY_ID,
      amount: 7500,
      status: 'draft',
      vendor_id: 1,
    };

    pushTableResult('vendors', { data: VALID_VENDOR, error: null });
    // Invoice lookup (when invoice_id is provided)
    pushTableResult('invoices', {
      data: { id: 'inv-1', amount_residual: 7500, company_id: TEST_COMPANY_ID },
    });
    pushTableResult('approval_rules', { data: [] });
    pushTableResult('payments', { data: createdPayment, error: null });

    const res = await POST(
      makePostRequest({
        vendor_id: 1,
        invoice_id: 10,
        amount: 7500,
        concept: 'Pago factura',
      }),
      routeCtx,
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.amount).toBe(7500);
  });

  it('rejects payment for already-paid invoice', async () => {
    pushTableResult('vendors', { data: VALID_VENDOR, error: null });
    pushTableResult('invoices', {
      data: { id: 'inv-paid', amount_residual: 0, company_id: TEST_COMPANY_ID },
    });

    const res = await POST(
      makePostRequest({
        vendor_id: 1,
        invoice_id: 20,
        amount: 1000,
        concept: 'Already paid',
      }),
      routeCtx,
    );

    expect(res.status).toBe(422);
  });

  it('returns 404 when linked invoice is not found', async () => {
    pushTableResult('vendors', { data: VALID_VENDOR, error: null });
    pushTableResult('invoices', { data: null });

    const res = await POST(
      makePostRequest({
        vendor_id: 1,
        invoice_id: 999,
        amount: 1000,
        concept: 'No invoice',
      }),
      routeCtx,
    );

    expect(res.status).toBe(404);
  });

  it('returns 400 on invalid body (missing required fields)', async () => {
    const res = await POST(
      makePostRequest({ vendor_id: 1 }),
      routeCtx,
    );

    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid JSON body', async () => {
    const req = new Request('http://localhost/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-valid-json',
    });

    const res = await POST(req, routeCtx);
    expect(res.status).toBe(400);
  });

  it('returns 500 on payment insert error', async () => {
    pushTableResult('vendors', { data: VALID_VENDOR, error: null });
    pushTableResult('approval_rules', { data: [] });
    pushTableResult('payments', { data: null, error: { message: 'Insert failed' } });

    const res = await POST(
      makePostRequest({
        vendor_id: 1,
        amount: 5000,
        concept: 'DB error',
      }),
      routeCtx,
    );

    expect(res.status).toBe(500);
  });
});
