/**
 * Tests for all cron route handlers:
 *   - GET /api/cron/sync-fintoc
 *   - GET /api/cron/sync-sat
 *   - GET /api/cron/check-overdue
 *   - GET /api/cron/check-scheduled
 *   - GET /api/cron/retry-webhooks
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock: verifyCronSecret — returns null (valid) by default ──

vi.mock('@/lib/middleware/cron-auth', () => ({
  verifyCronSecret: vi.fn().mockReturnValue(null),
}));

// ── Mock: sync-engine provider (sync-fintoc) ──

const mockProviderRun = vi.fn();
const mockProvider = { run: mockProviderRun };

vi.mock('@/packages/sync-engine', () => ({
  getProvider: vi.fn().mockReturnValue(mockProvider),
}));

// ── Mock: integrations side-effect import (sync-fintoc) ──

vi.mock('@/packages/integrations', () => ({}));

// ── Mock: syncSat (sync-sat) ──

const mockSyncSat = vi.fn();

vi.mock('@/lib/integrations/config', () => ({
  syncSat: (...args: unknown[]) => mockSyncSat(...args),
  getFintocConfigForCompany: vi.fn(),
}));

// ── Mock: fintoc createTransfer (check-scheduled) ──

const mockCreateTransfer = vi.fn();

vi.mock('@/lib/integrations/fintoc', () => ({
  createTransfer: (...args: unknown[]) => mockCreateTransfer(...args),
}));

// ── Mock: decrypt (check-scheduled) ──

vi.mock('@/lib/utils/crypto', () => ({
  decrypt: vi.fn().mockReturnValue({ secret_key: 'sk_test' }),
}));

// ── Mock: global fetch (retry-webhooks) ──

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Supabase admin mock — flexible per-table result queues ──
//
// Each call to .from(table) pops the next queued result for that table.
// Mutable calls (update, insert, notifications insert) resolve to
// { data: null, error: null } unless a result is explicitly queued.
//
// API:
//   pushTableResult(table, result)  — queue an awaited result for the table
//   clearTableResults()             — drain all queues

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

// Build a fully-resolved chain object.  Every builder method returns `chain`
// itself so arbitrary chaining works.  Terminal methods (.single, awaiting the
// chain) return a Promise with the next queued result for the table.
//
// Important: we deliberately do NOT add a `then` property to the chain object.
// Instead, `select / eq / ...` always return the same chain, and `single`
// returns a real Promise.  To make the chain awaitable (for the pattern
//   `await admin.from('t').select().eq()...`)
// we attach `.then` only once, via a plain helper that returns a
// *new* Promise each time — **not** by making the chain itself thenable in a
// way that causes recursive resolution.

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      // resolved is used when the chain is itself awaited
      let resolved = false;

      const chain: Record<string, unknown> = {};

      const self = (): typeof chain => chain;

      chain.select = vi.fn().mockImplementation(self);
      chain.eq = vi.fn().mockImplementation(self);
      chain.neq = vi.fn().mockImplementation(self);
      chain.not = vi.fn().mockImplementation(self);
      chain.lt = vi.fn().mockImplementation(self);
      chain.gt = vi.fn().mockImplementation(self);
      chain.lte = vi.fn().mockImplementation(self);
      chain.gte = vi.fn().mockImplementation(self);
      chain.in = vi.fn().mockImplementation(self);
      chain.order = vi.fn().mockImplementation(self);
      chain.limit = vi.fn().mockImplementation(self);

      // update returns a PLAIN object (not a thenble chain) with just .eq
      // so that `await admin.from(t).update({}).eq('id', x)` works.
      chain.update = vi.fn().mockImplementation(() => {
        const r = consumeResult(table);
        const mutChain: Record<string, unknown> = {};
        // .eq() returns a Promise directly
        mutChain.eq = vi.fn().mockResolvedValue(r);
        // also make it thenable for `await admin.from(t).update({})`
        mutChain.then = (
          resolve: (v: unknown) => void,
          reject?: (e: unknown) => void,
        ) => Promise.resolve(r).then(resolve, reject);
        return mutChain;
      });

      // insert returns a Promise directly
      chain.insert = vi.fn().mockImplementation(() => {
        return Promise.resolve(consumeResult(table));
      });

      // .single() returns a real Promise
      chain.single = vi.fn().mockImplementation(() => {
        return Promise.resolve(consumeResult(table));
      });

      // Make the chain itself awaitable exactly once per from() call.
      // We use a getter so that the promise is only created when `.then` is
      // actually accessed, preventing eager resolution.
      Object.defineProperty(chain, 'then', {
        get() {
          if (!resolved) {
            resolved = true;
            const p = Promise.resolve(consumeResult(table));
            return p.then.bind(p);
          }
          // Already resolved — return undefined so it's not re-awaited
          return undefined;
        },
        configurable: true,
      });

      return chain;
    },
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({}),
}));

// ── Helpers ──

function makeCronRequest(url = 'http://localhost/api/cron/test'): Request {
  return new Request(url, {
    method: 'GET',
    headers: { Authorization: 'Bearer test-cron-secret' },
  });
}

// ── Tests ──

describe('GET /api/cron/sync-fintoc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTableResults();
    process.env.CRON_SECRET = 'test-cron-secret';
  });

  it('returns 401 when cron secret is invalid', async () => {
    const { verifyCronSecret } = await import('@/lib/middleware/cron-auth');
    vi.mocked(verifyCronSecret).mockReturnValueOnce(
      Response.json(
        { error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret' } },
        { status: 401 },
      ),
    );

    const { GET } = await import('./sync-fintoc/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns empty results when no connected integrations exist', async () => {
    pushTableResult('integrations', { data: [], error: null });

    const { GET } = await import('./sync-fintoc/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.processed).toBe(0);
    expect(body.data.results).toEqual([]);
  });

  it('returns empty results when integrations query returns null', async () => {
    pushTableResult('integrations', { data: null, error: null });

    const { GET } = await import('./sync-fintoc/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.processed).toBe(0);
    expect(body.data.results).toEqual([]);
  });

  it('successfully syncs each connected fintoc integration', async () => {
    pushTableResult('integrations', {
      data: [
        { company_id: 'company-1' },
        { company_id: 'company-2' },
      ],
      error: null,
    });

    mockProviderRun
      .mockResolvedValueOnce({
        status: 'completed',
        recordsSynced: 10,
        errors: [],
      })
      .mockResolvedValueOnce({
        status: 'partial',
        recordsSynced: 3,
        errors: [{ entity: 'movements', message: 'Partial error' }],
      });

    const { GET } = await import('./sync-fintoc/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.processed).toBe(2);
    expect(body.data.results).toHaveLength(2);

    expect(body.data.results[0]).toMatchObject({
      company_id: 'company-1',
      status: 'completed',
      records_synced: 10,
    });
    expect(body.data.results[0].error).toBeUndefined();

    expect(body.data.results[1]).toMatchObject({
      company_id: 'company-2',
      status: 'partial',
      records_synced: 3,
    });
    expect(body.data.results[1].error).toContain('movements');

    expect(mockProviderRun).toHaveBeenCalledTimes(2);
    expect(mockProviderRun).toHaveBeenCalledWith('company-1');
    expect(mockProviderRun).toHaveBeenCalledWith('company-2');
  });

  it('skips integration when SYNC_IN_PROGRESS error is thrown', async () => {
    pushTableResult('integrations', {
      data: [{ company_id: 'company-locked' }],
      error: null,
    });

    const syncInProgress = new Error('Already running') as Error & { code: string };
    syncInProgress.code = 'SYNC_IN_PROGRESS';
    mockProviderRun.mockRejectedValueOnce(syncInProgress);

    const { GET } = await import('./sync-fintoc/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.processed).toBe(1);
    expect(body.data.results[0]).toMatchObject({
      company_id: 'company-locked',
      status: 'skipped',
      skipped: true,
      error: 'Sync already running',
    });
  });

  it('records failed status for non-SYNC_IN_PROGRESS errors', async () => {
    pushTableResult('integrations', {
      data: [{ company_id: 'company-err' }],
      error: null,
    });

    mockProviderRun.mockRejectedValueOnce(new Error('Network timeout'));

    const { GET } = await import('./sync-fintoc/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.results[0]).toMatchObject({
      company_id: 'company-err',
      status: 'failed',
      error: 'Network timeout',
    });
  });
});

describe('GET /api/cron/sync-sat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTableResults();
    process.env.CRON_SECRET = 'test-cron-secret';
  });

  it('returns empty results when no connected SAT integrations exist', async () => {
    pushTableResult('integrations', { data: [], error: null });

    const { GET } = await import('./sync-sat/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.processed).toBe(0);
    expect(body.data.results).toEqual([]);
  });

  it('successfully syncs each SAT integration with a taxpayer_id', async () => {
    pushTableResult('integrations', {
      data: [
        { company_id: 'company-sat-1', syntage_taxpayer_id: 'tp_abc' },
        { company_id: 'company-sat-2', syntage_taxpayer_id: 'tp_xyz' },
      ],
      error: null,
    });

    mockSyncSat
      .mockResolvedValueOnce({
        status: 'completed',
        extractions: [{ extractor: 'invoice', extractionId: 'ext_1', status: 'pending' }],
        errors: [],
      })
      .mockResolvedValueOnce({
        status: 'completed',
        extractions: [{ extractor: 'tax_status', extractionId: 'ext_2', status: 'pending' }],
        errors: [],
      });

    const { GET } = await import('./sync-sat/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.processed).toBe(2);
    expect(body.data.results).toHaveLength(2);

    expect(body.data.results[0]).toMatchObject({
      company_id: 'company-sat-1',
      status: 'completed',
    });
    expect(body.data.results[1]).toMatchObject({
      company_id: 'company-sat-2',
      status: 'completed',
    });

    expect(mockSyncSat).toHaveBeenCalledWith('company-sat-1', 'tp_abc');
    expect(mockSyncSat).toHaveBeenCalledWith('company-sat-2', 'tp_xyz');
  });

  it('skips integration without syntage_taxpayer_id (in-memory guard)', async () => {
    // The query already filters with .not('syntage_taxpayer_id', 'is', null),
    // but the route also has an in-loop guard for belt-and-suspenders.
    // We can test it by returning an integration with a falsy taxpayer_id.
    pushTableResult('integrations', {
      data: [{ company_id: 'company-no-taxpayer', syntage_taxpayer_id: null }],
      error: null,
    });

    const { GET } = await import('./sync-sat/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    // syncSat should NOT have been called
    expect(mockSyncSat).not.toHaveBeenCalled();

    expect(body.data.processed).toBe(1);
    expect(body.data.results[0]).toMatchObject({
      company_id: 'company-no-taxpayer',
      status: 'skipped',
      skipped: true,
      error: 'No taxpayer ID configured',
    });
  });

  it('skips integration when SYNC_IN_PROGRESS error is thrown', async () => {
    pushTableResult('integrations', {
      data: [{ company_id: 'company-sat-locked', syntage_taxpayer_id: 'tp_locked' }],
      error: null,
    });

    const syncInProgress = new Error('Sync running') as Error & { code: string };
    syncInProgress.code = 'SYNC_IN_PROGRESS';
    mockSyncSat.mockRejectedValueOnce(syncInProgress);

    const { GET } = await import('./sync-sat/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.results[0]).toMatchObject({
      company_id: 'company-sat-locked',
      status: 'skipped',
      skipped: true,
      error: 'Sync already running',
    });
  });

  it('records failed status for non-SYNC_IN_PROGRESS errors', async () => {
    pushTableResult('integrations', {
      data: [{ company_id: 'company-sat-err', syntage_taxpayer_id: 'tp_err' }],
      error: null,
    });

    mockSyncSat.mockRejectedValueOnce(new Error('Syntage API down'));

    const { GET } = await import('./sync-sat/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.results[0]).toMatchObject({
      company_id: 'company-sat-err',
      status: 'failed',
      error: 'Syntage API down',
    });
  });
});

describe('GET /api/cron/check-overdue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTableResults();
    process.env.CRON_SECRET = 'test-cron-secret';
  });

  it('returns checked=0 and updated=0 when no invoices are overdue', async () => {
    pushTableResult('invoices', { data: [], error: null });

    const { GET } = await import('./check-overdue/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.checked).toBe(0);
    expect(body.data.updated).toBe(0);
  });

  it('returns checked=0 and updated=0 when invoices query returns null', async () => {
    pushTableResult('invoices', { data: null, error: null });

    const { GET } = await import('./check-overdue/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.checked).toBe(0);
    expect(body.data.updated).toBe(0);
  });

  it('updates overdue invoices and notifies admins', async () => {
    // First DB call: select overdue invoices
    pushTableResult('invoices', {
      data: [
        {
          id: 'inv-1',
          company_id: 'company-A',
          invoice_number: 'FAC-001',
          amount_residual: 5000,
          due_date: '2026-03-01',
          type: 'payable',
        },
        {
          id: 'inv-2',
          company_id: 'company-B',
          invoice_number: 'FAC-002',
          amount_residual: 1200,
          due_date: '2026-02-28',
          type: 'receivable',
        },
      ],
      error: null,
    });

    // user_companies for company-A → one admin
    pushTableResult('user_companies', {
      data: [{ user_id: 'user-admin-1' }],
      error: null,
    });

    // user_companies for company-B → one admin
    pushTableResult('user_companies', {
      data: [{ user_id: 'user-admin-2' }],
      error: null,
    });

    const { GET } = await import('./check-overdue/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.checked).toBe(2);
    expect(body.data.updated).toBe(2);
  });

  it('handles invoices with no admins without crashing', async () => {
    pushTableResult('invoices', {
      data: [
        {
          id: 'inv-3',
          company_id: 'company-no-admin',
          invoice_number: 'FAC-003',
          amount_residual: 999,
          due_date: '2026-03-01',
          type: 'payable',
        },
      ],
      error: null,
    });

    // No admins found
    pushTableResult('user_companies', { data: [], error: null });

    const { GET } = await import('./check-overdue/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.checked).toBe(1);
    expect(body.data.updated).toBe(1);
  });
});

describe('GET /api/cron/check-scheduled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTableResults();
    process.env.CRON_SECRET = 'test-cron-secret';
    process.env.FINTOC_SECRET_KEY = 'sk_env_fallback';
  });

  it('returns found=0 when no scheduled payments exist', async () => {
    pushTableResult('payments', { data: [], error: null });

    const { GET } = await import('./check-scheduled/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.found).toBe(0);
    expect(body.data.processed).toBe(0);
    expect(body.data.failed).toBe(0);
  });

  it('skips payment that already has a fintoc_transfer_id (idempotent)', async () => {
    pushTableResult('payments', {
      data: [
        {
          id: 'pay-1',
          company_id: 'company-1',
          amount: 1000,
          beneficiary_clabe: '123456789012345678',
          beneficiary_name: 'Vendor A',
          concept: 'Pago servicio',
          created_by: 'user-1',
          fintoc_transfer_id: 'tr_already_done',
        },
      ],
      error: null,
    });

    const { GET } = await import('./check-scheduled/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    // found=1 because it was in the query result, but processed=0 and failed=0
    // since the idempotent skip happens before the try block
    expect(body.data.found).toBe(1);
    expect(body.data.processed).toBe(0);
    expect(body.data.failed).toBe(0);
    expect(mockCreateTransfer).not.toHaveBeenCalled();
  });

  it('executes scheduled payment and updates to processing', async () => {
    pushTableResult('payments', {
      data: [
        {
          id: 'pay-2',
          company_id: 'company-2',
          amount: 2500,
          beneficiary_clabe: '012345678901234567',
          beneficiary_name: 'Vendor B',
          concept: 'Renta',
          created_by: 'user-2',
          fintoc_transfer_id: null,
        },
      ],
      error: null,
    });

    // integration config lookup
    pushTableResult('integrations', {
      data: { config_encrypted: 'encrypted_blob' },
      error: null,
    });

    // bank_accounts lookup for Fintoc account_id
    pushTableResult('bank_accounts', {
      data: { fintoc_account_id: 'acc_fintoc_1' },
      error: null,
    });

    mockCreateTransfer.mockResolvedValueOnce({ id: 'tr_new_123' });

    const { GET } = await import('./check-scheduled/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.found).toBe(1);
    expect(body.data.processed).toBe(1);
    expect(body.data.failed).toBe(0);

    expect(mockCreateTransfer).toHaveBeenCalledOnce();
    const [transferParams, secretKey] = mockCreateTransfer.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    expect(transferParams.amount).toBe(250000); // 2500 * 100
    expect(transferParams.currency).toBe('MXN');
    expect(transferParams.comment).toBe('Renta');
    expect(transferParams.account_id).toBe('acc_fintoc_1');
    expect(secretKey).toBe('sk_test'); // from decrypt mock
  });

  it('uses env FINTOC_SECRET_KEY when no integration config is present', async () => {
    pushTableResult('payments', {
      data: [
        {
          id: 'pay-3',
          company_id: 'company-3',
          amount: 500,
          beneficiary_clabe: '012345678901234567',
          beneficiary_name: 'Vendor C',
          concept: null,
          created_by: null,
          fintoc_transfer_id: null,
        },
      ],
      error: null,
    });

    // No integration config
    pushTableResult('integrations', { data: null, error: null });

    // bank_accounts lookup for Fintoc account_id
    pushTableResult('bank_accounts', {
      data: { fintoc_account_id: 'acc_fintoc_2' },
      error: null,
    });

    mockCreateTransfer.mockResolvedValueOnce({ id: 'tr_env_456' });

    const { GET } = await import('./check-scheduled/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.processed).toBe(1);
    // comment falls back to `Pago ${payment.id}`
    const [transferParams, secretKey] = mockCreateTransfer.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    expect(transferParams.comment).toBe('Pago pay-3');
    expect(transferParams.account_id).toBe('acc_fintoc_2');
    expect(secretKey).toBe('sk_env_fallback');
  });

  it('marks payment as failed when transfer creation throws', async () => {
    pushTableResult('payments', {
      data: [
        {
          id: 'pay-4',
          company_id: 'company-4',
          amount: 750,
          beneficiary_clabe: '012345678901234567',
          beneficiary_name: 'Vendor D',
          concept: 'Materiales',
          created_by: 'user-4',
          fintoc_transfer_id: null,
        },
      ],
      error: null,
    });

    pushTableResult('integrations', { data: null, error: null });
    pushTableResult('bank_accounts', {
      data: { fintoc_account_id: 'acc_fintoc_3' },
      error: null,
    });
    mockCreateTransfer.mockRejectedValueOnce(new Error('Fintoc API error'));

    const { GET } = await import('./check-scheduled/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.found).toBe(1);
    expect(body.data.processed).toBe(0);
    expect(body.data.failed).toBe(1);
  });

  it('counts payment as failed when no secret key is available', async () => {
    delete process.env.FINTOC_SECRET_KEY;

    pushTableResult('payments', {
      data: [
        {
          id: 'pay-5',
          company_id: 'company-5',
          amount: 300,
          beneficiary_clabe: '012345678901234567',
          beneficiary_name: 'Vendor E',
          concept: 'Servicios',
          created_by: 'user-5',
          fintoc_transfer_id: null,
        },
      ],
      error: null,
    });

    // integration with no config_encrypted
    pushTableResult('integrations', { data: { config_encrypted: null }, error: null });

    const { GET } = await import('./check-scheduled/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.failed).toBe(1);
    expect(body.data.processed).toBe(0);
    expect(mockCreateTransfer).not.toHaveBeenCalled();
  });
});

describe('GET /api/cron/retry-webhooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTableResults();
    process.env.CRON_SECRET = 'test-cron-secret';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.WEBHOOK_RETRY_SECRET = 'retry-secret';
  });

  it('returns found=0 when no unprocessed webhook logs exist', async () => {
    pushTableResult('webhook_logs', { data: [], error: null });

    const { GET } = await import('./retry-webhooks/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.found).toBe(0);
    expect(body.data.retried).toBe(0);
    expect(body.data.succeeded).toBe(0);
    expect(body.data.skipped_max_retries).toBe(0);
  });

  it('returns found=0 when webhook_logs query returns null', async () => {
    pushTableResult('webhook_logs', { data: null, error: null });

    const { GET } = await import('./retry-webhooks/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.found).toBe(0);
  });

  it('skips log when retry_count has reached MAX_RETRY_ATTEMPTS (3)', async () => {
    pushTableResult('webhook_logs', {
      data: [
        {
          id: 'wh-log-1',
          provider: 'fintoc',
          event_type: 'payment.updated',
          payload: { foo: 'bar' },
          error: 'Previous error',
          retry_count: 3,
        },
        {
          id: 'wh-log-2',
          provider: 'fintoc',
          event_type: 'payment.updated',
          payload: {},
          error: null,
          retry_count: 5,
        },
      ],
      error: null,
    });

    const { GET } = await import('./retry-webhooks/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.found).toBe(2);
    expect(body.data.skipped_max_retries).toBe(2);
    expect(body.data.retried).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('retries a log and marks it processed on 2xx response', async () => {
    pushTableResult('webhook_logs', {
      data: [
        {
          id: 'wh-log-ok',
          provider: 'fintoc',
          event_type: 'transfer.completed',
          payload: { transfer_id: 'tr_1' },
          error: null,
          retry_count: 0,
        },
      ],
      error: null,
    });

    // fetch returns a successful response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue('OK'),
    });

    const { GET } = await import('./retry-webhooks/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.found).toBe(1);
    expect(body.data.retried).toBe(1);
    expect(body.data.succeeded).toBe(1);
    expect(body.data.skipped_max_retries).toBe(0);

    // Verify fetch was called with correct URL and headers
    expect(mockFetch).toHaveBeenCalledOnce();
    const [fetchUrl, fetchOptions] = mockFetch.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(fetchUrl).toBe('http://localhost:3000/api/webhooks/fintoc');
    expect(fetchOptions.method).toBe('POST');
    expect(fetchOptions.headers['x-webhook-retry']).toBe('true');
    expect(fetchOptions.headers['x-webhook-log-id']).toBe('wh-log-ok');
    expect(fetchOptions.headers['x-webhook-retry-signature']).toBeTruthy();
  });

  it('records error in webhook_log when retry response is not ok', async () => {
    pushTableResult('webhook_logs', {
      data: [
        {
          id: 'wh-log-fail',
          provider: 'fintoc',
          event_type: 'transfer.failed',
          payload: { transfer_id: 'tr_2' },
          error: null,
          retry_count: 1,
        },
      ],
      error: null,
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('Internal Server Error'),
    });

    const { GET } = await import('./retry-webhooks/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.retried).toBe(1);
    expect(body.data.succeeded).toBe(0);
  });

  it('adds x-webhook-secret header for syntage provider retries', async () => {
    process.env.SYNTAGE_WEBHOOK_SECRET = 'syntage-secret-key';

    pushTableResult('webhook_logs', {
      data: [
        {
          id: 'wh-log-syntage',
          provider: 'syntage',
          event_type: 'extraction.completed',
          payload: { extraction_id: 'ext_1' },
          error: null,
          retry_count: 0,
        },
      ],
      error: null,
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue('OK'),
    });

    const { GET } = await import('./retry-webhooks/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);

    const [fetchUrl, fetchOptions] = mockFetch.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(fetchUrl).toBe('http://localhost:3000/api/webhooks/syntage');
    expect(fetchOptions.headers['x-webhook-secret']).toBe('syntage-secret-key');
  });

  it('handles fetch throwing an exception and still counts as retried', async () => {
    pushTableResult('webhook_logs', {
      data: [
        {
          id: 'wh-log-throw',
          provider: 'fintoc',
          event_type: 'payment.updated',
          payload: {},
          error: null,
          retry_count: 2,
        },
      ],
      error: null,
    });

    mockFetch.mockRejectedValueOnce(new Error('Network unreachable'));

    const { GET } = await import('./retry-webhooks/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    // The outer catch in retry-webhooks still counts it as retried
    expect(body.data.retried).toBe(1);
    expect(body.data.succeeded).toBe(0);
  });

  it('processes a mix of skipped and retried logs correctly', async () => {
    pushTableResult('webhook_logs', {
      data: [
        // Should be skipped — max retries
        {
          id: 'wh-skip-1',
          provider: 'fintoc',
          event_type: 'payment.updated',
          payload: {},
          error: null,
          retry_count: 3,
        },
        // Should be retried — retry_count=1
        {
          id: 'wh-retry-1',
          provider: 'fintoc',
          event_type: 'transfer.completed',
          payload: { id: 'tr_x' },
          error: null,
          retry_count: 1,
        },
        // Should also be skipped — retry_count=4
        {
          id: 'wh-skip-2',
          provider: 'syntage',
          event_type: 'extraction.completed',
          payload: {},
          error: 'old error',
          retry_count: 4,
        },
      ],
      error: null,
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue('OK'),
    });

    const { GET } = await import('./retry-webhooks/route');
    const res = await GET(makeCronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.found).toBe(3);
    expect(body.data.skipped_max_retries).toBe(2);
    expect(body.data.retried).toBe(1);
    expect(body.data.succeeded).toBe(1);
  });
});
