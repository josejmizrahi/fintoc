/**
 * Integration tests for POST /api/v2/sync and GET /api/v2/sync
 *
 * Mocks middleware (auth, rbac, rate-limit) and the sync engine so we can
 * exercise the route handler logic in isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Test constants ──

const TEST_COMPANY_ID = 5;
const TEST_USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const TEST_EMAIL = 'test@quimibond.mx';
const TEST_ROLE = 'admin';

// ── Mock: withAuth — bypass real auth, inject fake context ──

vi.mock('@/lib/middleware/auth', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  withAuth: (handler: Function) => {
    return async (req: Request, _params?: Record<string, unknown>) => {
      const ctx = {
        user_id: TEST_USER_ID,
        company_id: TEST_COMPANY_ID,
        role: TEST_ROLE,
        email: TEST_EMAIL,
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

// ── Mock: sync engine (getProvider) ──

const mockRun = vi.fn();
const mockGetProvider = vi.fn();

vi.mock('@/packages/sync-engine', () => ({
  getProvider: (...args: unknown[]) => mockGetProvider(...args),
}));

// ── Mock: integrations side-effect import ──

vi.mock('@/packages/integrations', () => ({}));

// ── Mock: Supabase admin client (for GET handler) ──

const mockFromChains: Record<string, { selectResult: unknown }> = {};

function setFromResult(table: string, data: unknown) {
  mockFromChains[table] = { selectResult: data };
}

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      const result = mockFromChains[table]?.selectResult ?? { data: [], error: null };
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.order = vi.fn().mockReturnValue(chain);
      chain.limit = vi.fn().mockReturnValue(chain);
      // Make the chain thenable so it resolves when awaited
      chain.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
        return Promise.resolve(result).then(resolve, reject);
      };
      return chain;
    },
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({}),
}));

// ── Helpers ──

function makePostRequest(body: unknown): Request {
  return new Request('http://localhost/api/v2/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(): Request {
  return new Request('http://localhost/api/v2/sync', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
}

const routeCtx = { params: Promise.resolve({}) };

// ── Tests ──

describe('POST /api/v2/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('successful Odoo sync returns success: true with sync result', async () => {
    const syncResult = {
      provider: 'odoo',
      status: 'completed',
      recordsSynced: 15,
      recordsFailed: 0,
      errors: [],
      startedAt: '2026-03-12T00:00:00.000Z',
      completedAt: '2026-03-12T00:00:01.000Z',
      details: { vendors: 10, invoices: 5 },
    };

    mockGetProvider.mockReturnValue({ run: mockRun });
    mockRun.mockResolvedValue(syncResult);

    const { POST } = await import('./route');
    const res = await POST(makePostRequest({ provider: 'odoo' }), routeCtx);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.provider).toBe('odoo');
    expect(data.data.status).toBe('completed');
    expect(data.data.recordsSynced).toBe(15);
    expect(data.data.recordsFailed).toBe(0);
    expect(data.data.details).toEqual({ vendors: 10, invoices: 5 });

    expect(mockGetProvider).toHaveBeenCalledWith('odoo');
    expect(mockRun).toHaveBeenCalledWith(String(TEST_COMPANY_ID));
  });

  it('successful Fintoc sync returns success: true with sync result', async () => {
    const syncResult = {
      provider: 'fintoc',
      status: 'completed',
      recordsSynced: 42,
      recordsFailed: 0,
      errors: [],
      startedAt: '2026-03-12T08:00:00.000Z',
      completedAt: '2026-03-12T08:00:05.000Z',
      details: { movements: 42 },
    };

    mockGetProvider.mockReturnValue({ run: mockRun });
    mockRun.mockResolvedValue(syncResult);

    const { POST } = await import('./route');
    const res = await POST(makePostRequest({ provider: 'fintoc' }), routeCtx);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.provider).toBe('fintoc');
    expect(data.data.recordsSynced).toBe(42);
    expect(data.data.details).toEqual({ movements: 42 });

    expect(mockGetProvider).toHaveBeenCalledWith('fintoc');
    expect(mockRun).toHaveBeenCalledWith(String(TEST_COMPANY_ID));
  });

  it('SAT/syntage provider returns webhook message without calling getProvider', async () => {
    const { POST } = await import('./route');

    // Test with 'syntage'
    const resSyntage = await POST(makePostRequest({ provider: 'syntage' }), routeCtx);
    const dataSyntage = await resSyntage.json();

    expect(resSyntage.status).toBe(200);
    expect(dataSyntage.success).toBe(true);
    expect(dataSyntage.data.provider).toBe('syntage');
    expect(dataSyntage.data.status).toBe('completed');
    expect(dataSyntage.data.recordsSynced).toBe(0);
    expect(dataSyntage.data.message).toContain('webhooks');
    expect(mockGetProvider).not.toHaveBeenCalled();

    // Test with 'sat' alias
    const resSat = await POST(makePostRequest({ provider: 'sat' }), routeCtx);
    const dataSat = await resSat.json();

    expect(resSat.status).toBe(200);
    expect(dataSat.success).toBe(true);
    expect(dataSat.data.provider).toBe('syntage');
    expect(dataSat.data.message).toContain('webhooks');
    expect(mockGetProvider).not.toHaveBeenCalled();
  });

  it('sync failure returns success: false', async () => {
    const failedResult = {
      provider: 'odoo',
      status: 'failed',
      recordsSynced: 0,
      recordsFailed: 5,
      errors: [{ entity: 'vendors', message: 'Connection timeout', retryable: true }],
      startedAt: '2026-03-12T00:00:00.000Z',
      completedAt: '2026-03-12T00:00:10.000Z',
      details: {},
    };

    mockGetProvider.mockReturnValue({ run: mockRun });
    mockRun.mockResolvedValue(failedResult);

    const { POST } = await import('./route');
    const res = await POST(makePostRequest({ provider: 'odoo' }), routeCtx);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(false);
    expect(data.data.status).toBe('failed');
    expect(data.data.recordsFailed).toBe(5);
    expect(data.data.errors).toHaveLength(1);
  });

  it('invalid provider is rejected by Zod validation', async () => {
    const { POST } = await import('./route');
    const res = await POST(makePostRequest({ provider: 'invalid_provider' }), routeCtx);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBeDefined();
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(mockGetProvider).not.toHaveBeenCalled();
  });

  it('syncDays outside 1-365 is rejected by Zod validation', async () => {
    const { POST } = await import('./route');

    // syncDays = 0 (below minimum of 1)
    const resTooLow = await POST(
      makePostRequest({ provider: 'odoo', options: { syncDays: 0 } }),
      routeCtx,
    );
    expect(resTooLow.status).toBe(400);
    const dataLow = await resTooLow.json();
    expect(dataLow.error.code).toBe('VALIDATION_ERROR');

    // syncDays = 400 (above maximum of 365)
    const resTooHigh = await POST(
      makePostRequest({ provider: 'odoo', options: { syncDays: 400 } }),
      routeCtx,
    );
    expect(resTooHigh.status).toBe(400);
    const dataHigh = await resTooHigh.json();
    expect(dataHigh.error.code).toBe('VALIDATION_ERROR');

    expect(mockGetProvider).not.toHaveBeenCalled();
  });
});

describe('GET /api/v2/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset from chain results
    for (const key of Object.keys(mockFromChains)) {
      delete mockFromChains[key];
    }
  });

  it('returns integrations and recent syncs', async () => {
    const mockIntegrations = [
      {
        provider: 'odoo',
        status: 'active',
        is_connected: true,
        last_sync: '2026-03-11T03:00:00.000Z',
        last_sync_at: '2026-03-11T03:00:00.000Z',
        last_sync_status: 'completed',
      },
      {
        provider: 'fintoc',
        status: 'active',
        is_connected: true,
        last_sync: '2026-03-11T08:00:00.000Z',
        last_sync_at: '2026-03-11T08:00:00.000Z',
        last_sync_status: 'completed',
      },
    ];

    const mockRecentSyncs = [
      {
        provider: 'odoo',
        status: 'completed',
        records_synced: 25,
        completed_at: '2026-03-11T03:00:05.000Z',
      },
      {
        provider: 'fintoc',
        status: 'partial',
        records_synced: 10,
        completed_at: '2026-03-11T08:00:03.000Z',
      },
    ];

    setFromResult('integrations', { data: mockIntegrations, error: null });
    setFromResult('sync_history', { data: mockRecentSyncs, error: null });

    const { GET } = await import('./route');
    const res = await GET(makeGetRequest(), routeCtx);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.integrations).toHaveLength(2);
    expect(data.data.integrations[0].provider).toBe('odoo');
    expect(data.data.integrations[1].provider).toBe('fintoc');
    expect(data.data.recentSyncs).toHaveLength(2);
    expect(data.data.recentSyncs[0].records_synced).toBe(25);
  });

  it('returns empty arrays when no integrations or syncs exist', async () => {
    setFromResult('integrations', { data: null, error: null });
    setFromResult('sync_history', { data: null, error: null });

    const { GET } = await import('./route');
    const res = await GET(makeGetRequest(), routeCtx);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.integrations).toEqual([]);
    expect(data.data.recentSyncs).toEqual([]);
  });
});
