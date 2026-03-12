/**
 * Payment & Approval Flow Tests
 *
 * Tests: create payment → approval routing → approve/reject → cancel
 * All Supabase calls are mocked at the admin client level.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Constants ──
const TEST_USER_ID = 'u-00000000-0000-0000-0000-000000000001';
const TEST_APPROVER_ID = 'u-00000000-0000-0000-0000-000000000002';
const TEST_TOKEN = 'valid-jwt-token';
const COMPANY_ID = 10;
const VENDOR_ID = 100;
const PAYMENT_ID = 200;
const INVOICE_ID = 300;
const RULE_ID = 400;
const APPROVAL_ID = 500;

// ── In-memory data ──
let vendors: Record<string, unknown>[] = [];
let payments: Record<string, unknown>[] = [];
let invoices: Record<string, unknown>[] = [];
let approvalRules: Record<string, unknown>[] = [];
let approvalRequests: Record<string, unknown>[] = [];
let notifications: Record<string, unknown>[] = [];
let auditLogs: Record<string, unknown>[] = [];
let nextPaymentId = PAYMENT_ID;
let nextApprovalId = APPROVAL_ID;

// ── Mock Supabase query chain ──

function createQueryChain(table: string) {
  const filters: Array<{ field: string; value: unknown }> = [];
  let insertedData: Record<string, unknown> | null = null;
  let updatedData: Record<string, unknown> | null = null;

  const getStore = (): Record<string, unknown>[] => {
    switch (table) {
      case 'vendors': return vendors;
      case 'payments': return payments;
      case 'invoices': return invoices;
      case 'approval_rules': return approvalRules;
      case 'approval_requests': return approvalRequests;
      case 'notifications': return notifications;
      case 'audit_log': return auditLogs;
      case 'user_companies': return [{
        user_id: TEST_USER_ID, company_id: COMPANY_ID, role: 'admin',
        is_active: true, status: 'active',
      }];
      default: return [];
    }
  };

  const applyFilters = () => {
    let results = [...getStore()];
    for (const f of filters) {
      results = results.filter(r => {
        // Handle numeric string comparison (route params are strings, mock data uses numbers)
        if (typeof r[f.field] === 'number' && typeof f.value === 'string') {
          return r[f.field] === Number(f.value);
        }
        if (typeof r[f.field] === 'string' && typeof f.value === 'number') {
          return Number(r[f.field]) === f.value;
        }
        return r[f.field] === f.value;
      });
    }
    return results;
  };

  const chain: Record<string, unknown> = {};

  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockImplementation((field: string, value: unknown) => {
    filters.push({ field, value });
    return chain;
  });
  chain.in = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.lte = vi.fn().mockReturnValue(chain);
  chain.or = vi.fn().mockReturnValue(chain);
  chain.not = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.range = vi.fn().mockReturnValue(chain);
  chain.delete = vi.fn().mockReturnValue(chain);

  chain.insert = vi.fn().mockImplementation((data: Record<string, unknown> | Record<string, unknown>[]) => {
    const rows = Array.isArray(data) ? data : [data];
    for (const row of rows) {
      if (table === 'payments') {
        const p = { ...row, id: nextPaymentId++ };
        payments.push(p);
        insertedData = p;
      } else if (table === 'approval_requests') {
        const a = { ...row, id: nextApprovalId++ };
        approvalRequests.push(a);
        insertedData = a;
      } else if (table === 'notifications') {
        notifications.push(row);
        insertedData = row;
      } else if (table === 'audit_log') {
        auditLogs.push(row);
        insertedData = row;
      } else {
        insertedData = row;
      }
    }
    return chain;
  });

  chain.update = vi.fn().mockImplementation((data: Record<string, unknown>) => {
    updatedData = data;
    // Apply to matching records
    const results = applyFilters();
    for (const r of results) {
      Object.assign(r, data);
    }
    return chain;
  });

  chain.single = vi.fn().mockImplementation(async () => {
    if (insertedData) return { data: insertedData, error: null };
    if (updatedData) {
      const results = applyFilters();
      return results.length > 0
        ? { data: results[0], error: null }
        : { data: null, error: { code: 'PGRST116' } };
    }
    const results = applyFilters();
    return results.length > 0
      ? { data: results[0], error: null }
      : { data: null, error: { code: 'PGRST116' } };
  });

  chain.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
    const data = applyFilters();
    return Promise.resolve({ data, count: data.length, error: null }).then(resolve, reject);
  };

  return chain;
}

// ── Mock admin client ──

const mockAdmin = {
  from: vi.fn().mockImplementation((table: string) => createQueryChain(table)),
  auth: {
    getUser: vi.fn().mockImplementation(async (token: string) => {
      if (token === TEST_TOKEN) {
        return {
          data: { user: { id: TEST_USER_ID, email: 'admin@test.com', user_metadata: {} } },
          error: null,
        };
      }
      return { data: { user: null }, error: { message: 'Invalid token' } };
    }),
  },
};

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => mockAdmin,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockAdmin,
}));

vi.mock('@/lib/middleware/rate-limit', () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/middleware/audit', () => ({
  writeAuditLog: vi.fn().mockImplementation(async (entry: Record<string, unknown>) => {
    auditLogs.push(entry);
  }),
}));

// ── Helpers ──

function makeRequest(method: string, url: string, body?: unknown) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'cookie': `qb_access_token=${TEST_TOKEN}`,
  };
  return new Request(`http://localhost${url}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

// ── Setup ──

beforeEach(() => {
  vi.clearAllMocks();
  vendors = [{
    id: VENDOR_ID, company_id: COMPANY_ID, name: 'Proveedor Test SA',
    rfc: 'PTE010101AAA', clabe: '012180015678901234', efos_status: null,
  }];
  payments = [];
  invoices = [{
    id: INVOICE_ID, company_id: COMPANY_ID, type: 'payable',
    amount_total: 50000, amount_residual: 50000, status: 'open',
  }];
  approvalRules = [];
  approvalRequests = [];
  notifications = [];
  auditLogs = [];
  nextPaymentId = PAYMENT_ID;
  nextApprovalId = APPROVAL_ID;
});

// ── Payment Creation Tests ──

describe('POST /api/payments — Create payment', () => {
  it('creates a draft payment for a valid vendor', async () => {
    vi.resetModules();
    const { POST } = await import('../payments/route');

    const req = makeRequest('POST', '/api/payments', {
      vendor_id: VENDOR_ID,
      amount: 25000,
      concept: 'Pago servicio mensual',
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.data.amount).toBe(25000);
    expect(data.data.status).toBe('draft');
    expect(data.data.beneficiary_name).toBe('Proveedor Test SA');
    expect(data.data.clabe).toBe('012180015678901234');
    expect(payments).toHaveLength(1);
  });

  it('creates a scheduled payment when scheduled_date is provided', async () => {
    vi.resetModules();
    const { POST } = await import('../payments/route');

    const req = makeRequest('POST', '/api/payments', {
      vendor_id: VENDOR_ID,
      amount: 15000,
      concept: 'Pago programado',
      scheduled_date: '2026-04-01',
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.data.status).toBe('scheduled');
    expect(data.data.scheduled_date).toBe('2026-04-01');
  });

  it('rejects payment to EFOS-blocked vendor', async () => {
    vendors[0].efos_status = 'definitivo';

    vi.resetModules();
    const { POST } = await import('../payments/route');

    const req = makeRequest('POST', '/api/payments', {
      vendor_id: VENDOR_ID,
      amount: 10000,
      concept: 'Pago test',
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error.code).toBe('VENDOR_EFOS_BLOCKED');
  });

  it('rejects payment to vendor without CLABE', async () => {
    vendors[0].clabe = null;

    vi.resetModules();
    const { POST } = await import('../payments/route');

    const req = makeRequest('POST', '/api/payments', {
      vendor_id: VENDOR_ID,
      amount: 10000,
      concept: 'Pago test',
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error.code).toBe('VENDOR_NO_CLABE');
  });

  it('rejects payment with invalid body (missing amount)', async () => {
    vi.resetModules();
    const { POST } = await import('../payments/route');

    const req = makeRequest('POST', '/api/payments', {
      vendor_id: VENDOR_ID,
      concept: 'Sin monto',
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
  });

  it('rejects payment with negative amount', async () => {
    vi.resetModules();
    const { POST } = await import('../payments/route');

    const req = makeRequest('POST', '/api/payments', {
      vendor_id: VENDOR_ID,
      amount: -5000,
      concept: 'Monto negativo',
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
  });
});

// ── Approval Routing Tests ──

describe('POST /api/payments — Approval routing', () => {
  it('routes to pending_approval when rule matches and auto_approve is false', async () => {
    approvalRules.push({
      id: RULE_ID, company_id: COMPANY_ID, is_active: true,
      amount_min: 10000, amount_max: null, auto_approve: false,
      approvers: [TEST_APPROVER_ID],
    });

    vi.resetModules();
    const { POST } = await import('../payments/route');

    const req = makeRequest('POST', '/api/payments', {
      vendor_id: VENDOR_ID,
      amount: 50000,
      concept: 'Pago grande',
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.data.status).toBe('pending_approval');
    expect(data.data.approval_request).toBeDefined();
    expect(approvalRequests).toHaveLength(1);
    expect(approvalRequests[0].entity_type).toBe('payment');
    expect(approvalRequests[0].status).toBe('pending');
    // Notification sent to approver
    expect(notifications).toHaveLength(1);
    expect(notifications[0].user_id).toBe(TEST_APPROVER_ID);
  });

  it('creates draft payment when amount is below rule threshold', async () => {
    approvalRules.push({
      id: RULE_ID, company_id: COMPANY_ID, is_active: true,
      amount_min: 100000, amount_max: null, auto_approve: false,
      approvers: [TEST_APPROVER_ID],
    });

    vi.resetModules();
    const { POST } = await import('../payments/route');

    const req = makeRequest('POST', '/api/payments', {
      vendor_id: VENDOR_ID,
      amount: 5000,
      concept: 'Pago chico',
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.data.status).toBe('draft');
    expect(approvalRequests).toHaveLength(0);
  });

  it('auto-approves when rule has auto_approve enabled', async () => {
    approvalRules.push({
      id: RULE_ID, company_id: COMPANY_ID, is_active: true,
      amount_min: 0, amount_max: null, auto_approve: true,
      approvers: [],
    });

    vi.resetModules();
    const { POST } = await import('../payments/route');

    const req = makeRequest('POST', '/api/payments', {
      vendor_id: VENDOR_ID,
      amount: 50000,
      concept: 'Auto aprobado',
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.data.status).toBe('draft');
    expect(approvalRequests).toHaveLength(0);
  });
});

// ── Approval Approve/Reject Tests ──

describe('POST /api/approvals/:id/approve', () => {
  beforeEach(() => {
    approvalRequests.push({
      id: APPROVAL_ID, company_id: COMPANY_ID, entity_type: 'payment',
      entity_id: PAYMENT_ID, rule_id: RULE_ID, amount: 50000,
      requested_by: TEST_USER_ID, status: 'pending',
      approval_rules: { approvers: [TEST_USER_ID] },
    });
    payments.push({
      id: PAYMENT_ID, company_id: COMPANY_ID, status: 'pending_approval',
      amount: 50000,
    });
  });

  it('approves a pending request and updates payment to pending', async () => {
    vi.resetModules();
    const { POST } = await import('../approvals/[id]/approve/route');

    const req = makeRequest('POST', `/api/approvals/${APPROVAL_ID}/approve`);
    const res = await POST(req, { params: Promise.resolve({ id: String(APPROVAL_ID) }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data.message).toContain('aprobada');
    expect(approvalRequests[0].status).toBe('approved');
    expect(payments[0].status).toBe('pending');
  });

  it('rejects approving an already resolved request', async () => {
    approvalRequests[0].status = 'approved';

    vi.resetModules();
    const { POST } = await import('../approvals/[id]/approve/route');

    const req = makeRequest('POST', `/api/approvals/${APPROVAL_ID}/approve`);
    const res = await POST(req, { params: Promise.resolve({ id: String(APPROVAL_ID) }) });

    expect(res.status).toBe(422);
  });
});

describe('POST /api/approvals/:id/reject', () => {
  beforeEach(() => {
    approvalRequests.push({
      id: APPROVAL_ID, company_id: COMPANY_ID, entity_type: 'payment',
      entity_id: PAYMENT_ID, rule_id: RULE_ID, amount: 50000,
      requested_by: TEST_USER_ID, status: 'pending',
    });
    payments.push({
      id: PAYMENT_ID, company_id: COMPANY_ID, status: 'pending_approval',
      amount: 50000,
    });
  });

  it('rejects a pending request and cancels the payment', async () => {
    vi.resetModules();
    const { POST } = await import('../approvals/[id]/reject/route');

    const req = makeRequest('POST', `/api/approvals/${APPROVAL_ID}/reject`, {
      reason: 'Monto excesivo',
    });
    const res = await POST(req, { params: Promise.resolve({ id: String(APPROVAL_ID) }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data.message).toContain('rechazada');
    expect(approvalRequests[0].status).toBe('rejected');
    expect(approvalRequests[0].rejection_reason).toBe('Monto excesivo');
    expect(payments[0].status).toBe('cancelled');
  });

  it('requires a non-empty reason', async () => {
    vi.resetModules();
    const { POST } = await import('../approvals/[id]/reject/route');

    const req = makeRequest('POST', `/api/approvals/${APPROVAL_ID}/reject`, {
      reason: '',
    });
    const res = await POST(req, { params: Promise.resolve({ id: String(APPROVAL_ID) }) });

    expect(res.status).toBe(400);
  });

  it('rejects rejecting an already resolved request', async () => {
    approvalRequests[0].status = 'rejected';

    vi.resetModules();
    const { POST } = await import('../approvals/[id]/reject/route');

    const req = makeRequest('POST', `/api/approvals/${APPROVAL_ID}/reject`, {
      reason: 'Too late',
    });
    const res = await POST(req, { params: Promise.resolve({ id: String(APPROVAL_ID) }) });

    expect(res.status).toBe(422);
  });
});

// ── Payment Cancellation Tests ──

describe('POST /api/payments/:id/cancel', () => {
  it('cancels a draft payment', async () => {
    payments.push({
      id: PAYMENT_ID, company_id: COMPANY_ID, status: 'draft',
      amount: 25000,
    });

    vi.resetModules();
    const { POST } = await import('../payments/[id]/cancel/route');

    const req = makeRequest('POST', `/api/payments/${PAYMENT_ID}/cancel`);
    const res = await POST(req, { params: Promise.resolve({ id: String(PAYMENT_ID) }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data.status).toBe('cancelled');
  });

  it('cancels a pending_approval payment', async () => {
    payments.push({
      id: PAYMENT_ID, company_id: COMPANY_ID, status: 'pending_approval',
      amount: 50000,
    });

    vi.resetModules();
    const { POST } = await import('../payments/[id]/cancel/route');

    const req = makeRequest('POST', `/api/payments/${PAYMENT_ID}/cancel`);
    const res = await POST(req, { params: Promise.resolve({ id: String(PAYMENT_ID) }) });

    expect(res.status).toBe(200);
  });

  it('cancels a scheduled payment', async () => {
    payments.push({
      id: PAYMENT_ID, company_id: COMPANY_ID, status: 'scheduled',
      amount: 15000,
    });

    vi.resetModules();
    const { POST } = await import('../payments/[id]/cancel/route');

    const req = makeRequest('POST', `/api/payments/${PAYMENT_ID}/cancel`);
    const res = await POST(req, { params: Promise.resolve({ id: String(PAYMENT_ID) }) });

    expect(res.status).toBe(200);
  });

  it('rejects cancelling a confirmed payment', async () => {
    payments.push({
      id: PAYMENT_ID, company_id: COMPANY_ID, status: 'confirmed',
      amount: 25000,
    });

    vi.resetModules();
    const { POST } = await import('../payments/[id]/cancel/route');

    const req = makeRequest('POST', `/api/payments/${PAYMENT_ID}/cancel`);
    const res = await POST(req, { params: Promise.resolve({ id: String(PAYMENT_ID) }) });

    expect(res.status).toBe(422);
  });

  it('rejects cancelling a processing payment', async () => {
    payments.push({
      id: PAYMENT_ID, company_id: COMPANY_ID, status: 'processing',
      amount: 25000,
    });

    vi.resetModules();
    const { POST } = await import('../payments/[id]/cancel/route');

    const req = makeRequest('POST', `/api/payments/${PAYMENT_ID}/cancel`);
    const res = await POST(req, { params: Promise.resolve({ id: String(PAYMENT_ID) }) });

    expect(res.status).toBe(422);
  });

  it('returns 404 for non-existent payment', async () => {
    vi.resetModules();
    const { POST } = await import('../payments/[id]/cancel/route');

    const req = makeRequest('POST', '/api/payments/99999/cancel');
    const res = await POST(req, { params: Promise.resolve({ id: '99999' }) });

    expect(res.status).toBe(404);
  });
});

// ── Full Flow: Create → Approve → Verify ──

describe('Full flow: Create payment → Require approval → Approve', () => {
  it('creates payment needing approval, then approves it', async () => {
    approvalRules.push({
      id: RULE_ID, company_id: COMPANY_ID, is_active: true,
      amount_min: 10000, amount_max: null, auto_approve: false,
      approvers: [TEST_USER_ID],
    });

    // Step 1: Create payment
    vi.resetModules();
    const paymentRoute = await import('../payments/route');

    const createReq = makeRequest('POST', '/api/payments', {
      vendor_id: VENDOR_ID,
      amount: 75000,
      concept: 'Compra de materiales',
    });

    const createRes = await paymentRoute.POST(createReq, { params: Promise.resolve({}) });
    const createData = await createRes.json();

    expect(createRes.status).toBe(201);
    expect(createData.data.status).toBe('pending_approval');
    const paymentId = createData.data.id;
    const approvalRequestId = createData.data.approval_request.id;

    // Step 2: Approve
    vi.resetModules();
    const approveRoute = await import('../approvals/[id]/approve/route');

    // Ensure approval has the rule reference for the permission check
    const req2 = approvalRequests.find(a => a.id === approvalRequestId);
    if (req2) {
      req2.approval_rules = { approvers: [TEST_USER_ID] };
    }

    const approveReq = makeRequest('POST', `/api/approvals/${approvalRequestId}/approve`);
    const approveRes = await approveRoute.POST(approveReq, { params: Promise.resolve({ id: String(approvalRequestId) }) });

    expect(approveRes.status).toBe(200);

    // Verify: Payment status updated to pending, approval resolved
    const payment = payments.find(p => p.id === paymentId);
    expect(payment?.status).toBe('pending');

    const approval = approvalRequests.find(a => a.id === approvalRequestId);
    expect(approval?.status).toBe('approved');
  });
});
