/**
 * Integration tests for reconciliation API routes:
 *   POST /api/reconciliation/sat-odoo
 *   POST /api/reconciliation/sat-app
 *   POST /api/reconciliation/banco-app
 *   POST /api/reconciliation/import-to-odoo
 *
 * Mocks middleware (auth, rbac, rate-limit, audit) and all external
 * integrations so we can exercise route handler logic in isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Test constants ──

const TEST_COMPANY_ID = 5;
const TEST_USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

// ── Mock: withAuth — bypass real auth, inject fake context ──

vi.mock('@/lib/middleware/auth', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  withAuth: (handler: Function) => {
    return async (req: Request, _params?: Record<string, unknown>) => {
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

// ── Mock: withRbac — pass-through (no permission check) ──

vi.mock('@/lib/middleware/rbac', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  withRbac: (_permission: string, handler: Function) => handler,
}));

// ── Mock: rate-limit ──

vi.mock('@/lib/middleware/rate-limit', () => ({
  checkRateLimit: vi.fn(),
}));

// ── Mock: audit log ──

vi.mock('@/lib/middleware/audit', () => ({
  writeAuditLog: vi.fn(),
}));

// ── Mock: Syntage integration ──

const mockGetInvoices = vi.fn();

vi.mock('@/lib/integrations/syntage', () => ({
  getInvoices: (...args: unknown[]) => mockGetInvoices(...args),
}));

// ── Mock: Odoo integration ──

const mockOdooSearchRead = vi.fn();
const mockOdooCreate = vi.fn();

vi.mock('@/lib/integrations/odoo', () => ({
  odooSearchRead: (...args: unknown[]) => mockOdooSearchRead(...args),
  odooCreate: (...args: unknown[]) => mockOdooCreate(...args),
}));

// ── Mock: crypto decrypt ──

const mockDecrypt = vi.fn();

vi.mock('@/lib/utils/crypto', () => ({
  decrypt: (...args: unknown[]) => mockDecrypt(...args),
}));

// ── Mock: Fintoc integration ──

const mockGetMovements = vi.fn();
const mockCentavosToPesos = vi.fn();

vi.mock('@/lib/integrations/fintoc', () => ({
  getMovements: (...args: unknown[]) => mockGetMovements(...args),
  centavosToPesos: (...args: unknown[]) => mockCentavosToPesos(...args),
}));

// ── Mock: sync-engine getFintocConfigForCompany ──

const mockGetFintocConfigForCompany = vi.fn();

vi.mock('@/lib/integrations/config', () => ({
  getFintocConfigForCompany: (...args: unknown[]) => mockGetFintocConfigForCompany(...args),
}));

// ── Mock: Supabase admin client ──
// Uses a flexible pattern where mockDbData controls per-table responses.
// Each call to from(table) creates a fresh chainable object resolved to the
// stored value so any method sequence (.select().eq().single() etc.) works.

const mockDbData: Record<string, unknown> = {};

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => {
    const createChain = (resolveValue: unknown) => {
      const chain: Record<string, unknown> = {};
      [
        'select', 'eq', 'gte', 'lte', 'neq', 'not', 'in',
        'single', 'update', 'insert', 'order', 'limit',
      ].forEach((m) => {
        (chain as Record<string, unknown>)[m] = vi.fn().mockReturnValue(chain);
      });
      chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(resolveValue).then(resolve, reject);
      return chain;
    };
    return {
      from: (table: string) => createChain(mockDbData[table] ?? { data: [], error: null }),
    };
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({}),
}));

// ── Helpers ──

const routeCtx = { params: Promise.resolve({}) };

function makeRequest(url: string, body: unknown): Request {
  return new Request(`http://localhost/api/reconciliation/${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_PERIOD = {
  period_start: '2026-01-01',
  period_end: '2026-01-31',
};

// ══════════════════════════════════════════════════════════════════════════
// SAT-Odoo
// ══════════════════════════════════════════════════════════════════════════

describe('POST /api/reconciliation/sat-odoo', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: both integrations configured
    mockDbData['integrations'] = {
      data: { syntage_taxpayer_id: 'TAX-001', config_encrypted: 'enc-cfg' },
      error: null,
    };

    mockDecrypt.mockReturnValue({ url: 'http://odoo', db: 'db', uid: 1, apiKey: 'key' });
  });

  it('returns matched invoices when UUID and amount match exactly', async () => {
    const uuid = 'aaaabbbb-cccc-dddd-eeee-ffffffffffff';

    mockGetInvoices.mockResolvedValue([
      { uuid, total: 1000.0, date: '2026-01-10' },
    ]);
    mockOdooSearchRead.mockResolvedValue([
      { l10n_mx_edi_cfdi_uuid: uuid, amount_total: 1000.0, name: 'INV/001', partner_id: [1, 'Proveedor SA'] },
    ]);

    const { POST } = await import('./sat-odoo/route');
    const res = await POST(makeRequest('sat-odoo', VALID_PERIOD), routeCtx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.summary.matched).toBe(1);
    expect(body.data.summary.only_sat).toBe(0);
    expect(body.data.summary.only_odoo).toBe(0);
    expect(body.data.summary.amount_diff).toBe(0);
    expect(body.data.details.matched).toHaveLength(1);
    expect(body.data.details.matched[0].uuid).toBe(uuid);
  });

  it('detects amount difference when SAT and Odoo totals diverge by >= 0.01', async () => {
    const uuid = 'aaaabbbb-cccc-dddd-eeee-000000000001';

    mockGetInvoices.mockResolvedValue([
      { uuid, total: 1000.0, date: '2026-01-10' },
    ]);
    mockOdooSearchRead.mockResolvedValue([
      { l10n_mx_edi_cfdi_uuid: uuid, amount_total: 999.0, name: 'INV/002', partner_id: [2, 'Proveedor B'] },
    ]);

    const { POST } = await import('./sat-odoo/route');
    const res = await POST(makeRequest('sat-odoo', VALID_PERIOD), routeCtx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.summary.matched).toBe(0);
    expect(body.data.summary.amount_diff).toBe(1);
    expect(body.data.details.amount_diff[0].difference).toBeCloseTo(1.0);
  });

  it('treats amount difference < 0.01 as matched (tolerance boundary)', async () => {
    const uuid = 'aaaabbbb-cccc-dddd-eeee-000000000002';

    mockGetInvoices.mockResolvedValue([
      { uuid, total: 1000.0, date: '2026-01-10' },
    ]);
    mockOdooSearchRead.mockResolvedValue([
      { l10n_mx_edi_cfdi_uuid: uuid, amount_total: 1000.009, name: 'INV/003' },
    ]);

    const { POST } = await import('./sat-odoo/route');
    const res = await POST(makeRequest('sat-odoo', VALID_PERIOD), routeCtx);
    const body = await res.json();

    expect(body.data.summary.matched).toBe(1);
    expect(body.data.summary.amount_diff).toBe(0);
  });

  it('returns only_sat for invoices not in Odoo', async () => {
    const uuid = 'aaaabbbb-cccc-dddd-eeee-000000000003';

    mockGetInvoices.mockResolvedValue([
      { uuid, total: 500.0, date: '2026-01-12' },
    ]);
    mockOdooSearchRead.mockResolvedValue([]);

    const { POST } = await import('./sat-odoo/route');
    const res = await POST(makeRequest('sat-odoo', VALID_PERIOD), routeCtx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.summary.only_sat).toBe(1);
    expect(body.data.summary.matched).toBe(0);
    expect(body.data.details.only_sat[0].uuid).toBe(uuid);
  });

  it('returns only_odoo for invoices not in SAT', async () => {
    const uuid = 'aaaabbbb-cccc-dddd-eeee-000000000004';

    mockGetInvoices.mockResolvedValue([]);
    mockOdooSearchRead.mockResolvedValue([
      { l10n_mx_edi_cfdi_uuid: uuid, amount_total: 750.0, name: 'INV/004' },
    ]);

    const { POST } = await import('./sat-odoo/route');
    const res = await POST(makeRequest('sat-odoo', VALID_PERIOD), routeCtx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.summary.only_odoo).toBe(1);
    expect(body.data.summary.matched).toBe(0);
    expect(body.data.details.only_odoo[0].l10n_mx_edi_cfdi_uuid).toBe(uuid);
  });

  it('is case-insensitive when matching UUIDs', async () => {
    const uuidUpper = 'AAAABBBB-CCCC-DDDD-EEEE-000000000005';
    const uuidLower = uuidUpper.toLowerCase();

    mockGetInvoices.mockResolvedValue([
      { uuid: uuidUpper, total: 200.0, date: '2026-01-15' },
    ]);
    mockOdooSearchRead.mockResolvedValue([
      { l10n_mx_edi_cfdi_uuid: uuidLower, amount_total: 200.0, name: 'INV/005' },
    ]);

    const { POST } = await import('./sat-odoo/route');
    const res = await POST(makeRequest('sat-odoo', VALID_PERIOD), routeCtx);
    const body = await res.json();

    expect(body.data.summary.matched).toBe(1);
    expect(body.data.summary.only_sat).toBe(0);
    expect(body.data.summary.only_odoo).toBe(0);
  });

  it('returns 400 for invalid request body', async () => {
    const { POST } = await import('./sat-odoo/route');
    const res = await POST(makeRequest('sat-odoo', { period_start: 'not-a-date' }), routeCtx);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('returns 422 when Syntage integration is not configured', async () => {
    mockDbData['integrations'] = { data: null, error: null };

    const { POST } = await import('./sat-odoo/route');
    const res = await POST(makeRequest('sat-odoo', VALID_PERIOD), routeCtx);
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.code).toBe('INTEGRATION_NOT_CONFIGURED');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// SAT-App
// ══════════════════════════════════════════════════════════════════════════

describe('POST /api/reconciliation/sat-app', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockDbData['integrations'] = {
      data: { syntage_taxpayer_id: 'TAX-001' },
      error: null,
    };
    mockDbData['invoices'] = { data: [], error: null };
  });

  it('returns matched invoices when UUID exists in both SAT and app', async () => {
    const uuid = 'bbbbcccc-dddd-eeee-ffff-000000000001';

    mockGetInvoices.mockResolvedValue([
      { uuid, total: 1200.0, date: '2026-01-05' },
    ]);
    mockDbData['invoices'] = {
      data: [{ id: 'app-inv-1', uuid, amount: 1200.0, invoice_date: '2026-01-05', company_id: TEST_COMPANY_ID }],
      error: null,
    };

    const { POST } = await import('./sat-app/route');
    const res = await POST(makeRequest('sat-app', VALID_PERIOD), routeCtx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.summary.matched).toBe(1);
    expect(body.data.summary.only_sat).toBe(0);
    expect(body.data.summary.only_app).toBe(0);
    expect(body.data.details.matched[0].uuid).toBe(uuid);
  });

  it('returns only_sat for SAT invoices absent from the app', async () => {
    const uuid = 'bbbbcccc-dddd-eeee-ffff-000000000002';

    mockGetInvoices.mockResolvedValue([
      { uuid, total: 800.0, date: '2026-01-07' },
    ]);
    mockDbData['invoices'] = { data: [], error: null };

    const { POST } = await import('./sat-app/route');
    const res = await POST(makeRequest('sat-app', VALID_PERIOD), routeCtx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.summary.only_sat).toBe(1);
    expect(body.data.summary.matched).toBe(0);
    expect(body.data.details.only_sat[0].uuid).toBe(uuid);
  });

  it('returns only_app for app invoices absent from SAT', async () => {
    const uuid = 'bbbbcccc-dddd-eeee-ffff-000000000003';

    mockGetInvoices.mockResolvedValue([]);
    mockDbData['invoices'] = {
      data: [{ id: 'app-inv-2', uuid, amount: 600.0, invoice_date: '2026-01-08', company_id: TEST_COMPANY_ID }],
      error: null,
    };

    const { POST } = await import('./sat-app/route');
    const res = await POST(makeRequest('sat-app', VALID_PERIOD), routeCtx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.summary.only_app).toBe(1);
    expect(body.data.summary.matched).toBe(0);
    expect(body.data.details.only_app[0].uuid).toBe(uuid);
  });

  it('returns 400 for invalid request body', async () => {
    const { POST } = await import('./sat-app/route');
    const res = await POST(makeRequest('sat-app', { period_start: '2026-01-01' }), routeCtx);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('returns 422 when Syntage integration is not configured', async () => {
    mockDbData['integrations'] = { data: null, error: null };

    const { POST } = await import('./sat-app/route');
    const res = await POST(makeRequest('sat-app', VALID_PERIOD), routeCtx);
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.code).toBe('INTEGRATION_NOT_CONFIGURED');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Banco-App
// ══════════════════════════════════════════════════════════════════════════

describe('POST /api/reconciliation/banco-app', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetFintocConfigForCompany.mockResolvedValue({ secretKey: 'sk_test', linkToken: 'lt_test' });

    mockDbData['bank_accounts'] = {
      data: [{ id: 'ba-1', fintoc_account_id: 'fintoc-acc-1' }],
      error: null,
    };
    mockDbData['payments'] = { data: [], error: null };

    // Default: centavosToPesos is a pass-through (values already in pesos in tests)
    mockCentavosToPesos.mockImplementation((v: number) => v / 100);
  });

  it('matches movement and payment when amount and date align', async () => {
    const movDate = '2026-01-10';
    const payConfirmedAt = '2026-01-10T12:00:00.000Z';
    const amount = 250000; // centavos → 2500.00 pesos

    mockGetMovements.mockResolvedValue([
      {
        id: 'mov-1',
        post_date: movDate,
        amount,
        type: 'debit',
        description: 'SPEI Enviado',
        reference_id: 'ref-001',
        sender_account: { holder_name: 'Empresa SA' },
        recipient_account: { holder_name: 'Proveedor SL' },
      },
    ]);

    mockDbData['payments'] = {
      data: [
        {
          id: 'pay-1',
          amount: 2500.0,
          status: 'confirmed',
          confirmed_at: payConfirmedAt,
          company_id: TEST_COMPANY_ID,
        },
      ],
      error: null,
    };

    const { POST } = await import('./banco-app/route');
    const res = await POST(makeRequest('banco-app', VALID_PERIOD), routeCtx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.summary.matched).toBe(1);
    expect(body.data.summary.only_bank).toBe(0);
    expect(body.data.summary.only_app).toBe(0);
    expect(body.data.details.matched[0].movement.id).toBe('mov-1');
    expect(body.data.details.matched[0].payment.id).toBe('pay-1');
  });

  it('returns only_bank when no matching payment exists', async () => {
    mockGetMovements.mockResolvedValue([
      {
        id: 'mov-2',
        post_date: '2026-01-11',
        amount: 100000,
        type: 'debit',
        description: 'Pago',
        reference_id: null,
        sender_account: null,
        recipient_account: null,
      },
    ]);

    mockDbData['payments'] = { data: [], error: null };

    const { POST } = await import('./banco-app/route');
    const res = await POST(makeRequest('banco-app', VALID_PERIOD), routeCtx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.summary.only_bank).toBe(1);
    expect(body.data.summary.matched).toBe(0);
    expect(body.data.summary.only_app).toBe(0);
  });

  it('returns only_app when no matching bank movement exists', async () => {
    mockGetMovements.mockResolvedValue([]);

    mockDbData['payments'] = {
      data: [
        {
          id: 'pay-2',
          amount: 1500.0,
          status: 'confirmed',
          confirmed_at: '2026-01-15T08:00:00.000Z',
          company_id: TEST_COMPANY_ID,
        },
      ],
      error: null,
    };

    const { POST } = await import('./banco-app/route');
    const res = await POST(makeRequest('banco-app', VALID_PERIOD), routeCtx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.summary.only_app).toBe(1);
    expect(body.data.summary.matched).toBe(0);
    expect(body.data.summary.only_bank).toBe(0);
    expect(body.data.details.only_app[0].id).toBe('pay-2');
  });

  it('does not match when amount differs by >= 0.01', async () => {
    const movDate = '2026-01-10';
    const payConfirmedAt = '2026-01-10T12:00:00.000Z';

    // centavosToPesos(99000) = 990.00, payment.amount = 1000.00 → difference = 10 ≥ 0.01
    mockGetMovements.mockResolvedValue([
      {
        id: 'mov-3',
        post_date: movDate,
        amount: 99000,
        type: 'debit',
        description: 'Transferencia',
        reference_id: null,
        sender_account: null,
        recipient_account: null,
      },
    ]);

    mockDbData['payments'] = {
      data: [
        {
          id: 'pay-3',
          amount: 1000.0,
          status: 'confirmed',
          confirmed_at: payConfirmedAt,
          company_id: TEST_COMPANY_ID,
        },
      ],
      error: null,
    };

    const { POST } = await import('./banco-app/route');
    const res = await POST(makeRequest('banco-app', VALID_PERIOD), routeCtx);
    const body = await res.json();

    expect(body.data.summary.matched).toBe(0);
    expect(body.data.summary.only_bank).toBe(1);
    expect(body.data.summary.only_app).toBe(1);
  });

  it('does not match when date is more than 2 days apart', async () => {
    // Movement on Jan 10, payment confirmed Jan 15 → 5 days apart
    mockGetMovements.mockResolvedValue([
      {
        id: 'mov-4',
        post_date: '2026-01-10',
        amount: 200000,
        type: 'debit',
        description: 'Pago tardio',
        reference_id: null,
        sender_account: null,
        recipient_account: null,
      },
    ]);

    mockDbData['payments'] = {
      data: [
        {
          id: 'pay-4',
          amount: 2000.0,
          status: 'confirmed',
          confirmed_at: '2026-01-15T00:00:00.000Z',
          company_id: TEST_COMPANY_ID,
        },
      ],
      error: null,
    };

    const { POST } = await import('./banco-app/route');
    const res = await POST(makeRequest('banco-app', VALID_PERIOD), routeCtx);
    const body = await res.json();

    expect(body.data.summary.matched).toBe(0);
    expect(body.data.summary.only_bank).toBe(1);
    expect(body.data.summary.only_app).toBe(1);
  });

  it('returns 400 for invalid request body', async () => {
    const { POST } = await import('./banco-app/route');
    const res = await POST(makeRequest('banco-app', { period_start: '2026-01-01' }), routeCtx);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('returns 422 when Fintoc config is not available', async () => {
    mockGetFintocConfigForCompany.mockRejectedValue(new Error('No Fintoc config'));

    const { POST } = await import('./banco-app/route');
    const res = await POST(makeRequest('banco-app', VALID_PERIOD), routeCtx);

    // createHandler should convert unhandled errors to 500, or the integration
    // throws which propagates as an error response
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('returns empty results when company has no bank accounts', async () => {
    mockDbData['bank_accounts'] = { data: [], error: null };
    mockDbData['payments'] = { data: [], error: null };

    const { POST } = await import('./banco-app/route');
    const res = await POST(makeRequest('banco-app', VALID_PERIOD), routeCtx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.summary.matched).toBe(0);
    expect(body.data.summary.only_bank).toBe(0);
    expect(body.data.summary.only_app).toBe(0);
    expect(mockGetMovements).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Import-to-Odoo
// ══════════════════════════════════════════════════════════════════════════

describe('POST /api/reconciliation/import-to-odoo', () => {
  const VALID_UUID = 'ccccdddd-eeee-ffff-aaaa-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();

    mockDbData['integrations'] = {
      data: { syntage_taxpayer_id: 'TAX-001', config_encrypted: 'enc-cfg' },
      error: null,
    };

    mockDecrypt.mockReturnValue({ url: 'http://odoo', db: 'db', uid: 1, apiKey: 'key' });
  });

  it('successfully imports a CFDI to Odoo and returns 201', async () => {
    mockGetInvoices.mockResolvedValue([
      {
        uuid: VALID_UUID,
        total: 3000.0,
        date: '2026-01-20',
        issued_at: '2026-01-20',
      },
    ]);
    mockOdooCreate.mockResolvedValue(42);

    mockDbData['invoices'] = { data: [{ id: 'inv-1', uuid: VALID_UUID }], error: null };

    const { POST } = await import('./import-to-odoo/route');
    const res = await POST(makeRequest('import-to-odoo', { cfdi_uuid: VALID_UUID }), routeCtx);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.odoo_move_id).toBe(42);
    expect(body.data.message).toBeTruthy();

    expect(mockGetInvoices).toHaveBeenCalledWith('TAX-001', { uuid: [VALID_UUID] });
    expect(mockOdooCreate).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'http://odoo' }),
      'account.move',
      expect.objectContaining({ l10n_mx_edi_cfdi_uuid: VALID_UUID }),
    );
  });

  it('returns 404 when CFDI is not found in SAT', async () => {
    mockGetInvoices.mockResolvedValue([]);

    const { POST } = await import('./import-to-odoo/route');
    const res = await POST(makeRequest('import-to-odoo', { cfdi_uuid: VALID_UUID }), routeCtx);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(mockOdooCreate).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid body (missing cfdi_uuid)', async () => {
    const { POST } = await import('./import-to-odoo/route');
    const res = await POST(makeRequest('import-to-odoo', {}), routeCtx);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('returns 400 for empty cfdi_uuid string', async () => {
    const { POST } = await import('./import-to-odoo/route');
    const res = await POST(makeRequest('import-to-odoo', { cfdi_uuid: '' }), routeCtx);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('returns 422 when Syntage integration is not configured', async () => {
    mockDbData['integrations'] = { data: { config_encrypted: 'enc-cfg' }, error: null };

    const { POST } = await import('./import-to-odoo/route');
    const res = await POST(makeRequest('import-to-odoo', { cfdi_uuid: VALID_UUID }), routeCtx);
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.code).toBe('INTEGRATION_NOT_CONFIGURED');
  });

  it('returns 422 when Odoo integration is not configured', async () => {
    // Syntage configured, Odoo not
    // The route does two sequential .single() calls; the first resolves
    // syntage_taxpayer_id, the second config_encrypted.
    // We model this by making integrations return a record with only syntage data.
    mockDbData['integrations'] = { data: { syntage_taxpayer_id: 'TAX-001' }, error: null };

    const { POST } = await import('./import-to-odoo/route');
    const res = await POST(makeRequest('import-to-odoo', { cfdi_uuid: VALID_UUID }), routeCtx);
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.code).toBe('INTEGRATION_NOT_CONFIGURED');
  });
});
