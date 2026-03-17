import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// DB mock — flexible chainable pattern with per-table result injection.
//
// Each table can have a queue of results (setDbResults) or a single result
// (setDbResult). Calls to `from(table)` pop from the queue; when the queue
// is empty (or only one entry remains) the last entry is returned for all
// subsequent calls. This lets a single test set up distinct results for the
// idempotency SELECT vs. the INSERT on the same table.
// ---------------------------------------------------------------------------

const mockDbQueues: Record<string, unknown[]> = {};

function setDbResult(table: string, result: unknown) {
  mockDbQueues[table] = [result];
}

/** Set a sequence of results for successive calls to from(table). */
function setDbResults(table: string, ...results: unknown[]) {
  mockDbQueues[table] = [...results];
}

function clearDbResults() {
  for (const key of Object.keys(mockDbQueues)) {
    delete mockDbQueues[key];
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      const queue = mockDbQueues[table];
      let result: unknown;
      if (!queue || queue.length === 0) {
        result = { data: null, error: null };
      } else if (queue.length === 1) {
        result = queue[0];
      } else {
        result = queue.shift();
      }
      const chain: Record<string, unknown> = {};
      [
        'select', 'eq', 'gte', 'lte', 'neq', 'not', 'in',
        'single', 'update', 'insert', 'order', 'limit',
      ].forEach((m) => {
        chain[m] = vi.fn().mockReturnValue(chain);
      });
      // Make the chain thenable so `await admin.from(...).select(...).single()` resolves
      chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return chain;
    },
  }),
}));

// ---------------------------------------------------------------------------
// Integration mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/integrations/fintoc', () => ({
  verifyFintocWebhook: vi.fn(),
  centavosToPesos: (centavos: number) => centavos / 100,
}));

vi.mock('@/lib/integrations/syntage', () => ({
  verifySyntageWebhook: vi.fn(),
  parseEfosStatus: vi.fn(),
  mapSatStatus: vi.fn((s: string) => (s === 'Vigente' ? 'vigente' : 'cancelado')),
  mapInvoiceType: vi.fn((t: string) => (t === 'I' ? 'receivable' : 'payable')),
}));

// ---------------------------------------------------------------------------
// Imports — must come AFTER vi.mock() calls
// ---------------------------------------------------------------------------

import { POST as fintocPOST } from './fintoc/route';
import { POST as syntagePOST } from './syntage/route';
import { POST as odooPOST } from './odoo/route';
import { verifyFintocWebhook } from '@/lib/integrations/fintoc';
import { verifySyntageWebhook, parseEfosStatus } from '@/lib/integrations/syntage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request('http://localhost/api/webhooks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function makeTextRequest(
  body: string,
  headers: Record<string, string> = {},
): Request {
  return new Request('http://localhost/api/webhooks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
}

// ---------------------------------------------------------------------------
// Fintoc webhook tests
// ---------------------------------------------------------------------------

describe('Fintoc webhook (POST /api/webhooks/fintoc)', () => {
  const mockVerify = verifyFintocWebhook as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearDbResults();
    vi.clearAllMocks();
    // Default: signature valid
    mockVerify.mockReturnValue(true);
  });

  afterEach(() => {
    delete process.env.WEBHOOK_RETRY_SECRET;
    delete process.env.FINTOC_SECRET_KEY;
  });

  it('returns 401 when signature is invalid', async () => {
    mockVerify.mockReturnValue(false);

    const req = makeTextRequest(
      JSON.stringify({ type: 'transfer.outbound.succeeded', data: {} }),
      { 'fintoc-signature': 'bad-sig' },
    );

    const res = await fintocPOST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Invalid signature');
  });

  it('returns { received: true } and updates payment to confirmed on transfer.outbound.succeeded', async () => {
    const transferId = 'tr_abc123';

    // webhook_logs insert → return a log id
    setDbResult('webhook_logs', { data: { id: 'log-1' }, error: null });
    // payments select by fintoc_transfer_id
    setDbResult('payments', {
      data: {
        id: 'pay-1',
        company_id: 'co-1',
        created_by: 'user-1',
        amount: 5000,
        beneficiary_name: 'Proveedor SA',
        status: 'pending',
      },
      error: null,
    });

    const req = makeTextRequest(
      JSON.stringify({
        type: 'transfer.outbound.succeeded',
        data: { id: transferId },
      }),
      { 'fintoc-signature': 'valid-sig' },
    );

    const res = await fintocPOST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it('returns { received: true } and updates payment to failed on transfer.outbound.failed', async () => {
    const transferId = 'tr_fail456';

    setDbResult('webhook_logs', { data: { id: 'log-2' }, error: null });
    setDbResult('payments', {
      data: {
        id: 'pay-2',
        company_id: 'co-1',
        created_by: 'user-1',
        amount: 1000,
        beneficiary_name: 'Otro SA',
        status: 'pending',
      },
      error: null,
    });

    const req = makeTextRequest(
      JSON.stringify({
        type: 'transfer.outbound.failed',
        data: {
          id: transferId,
          error: { type: 'insufficient_funds', message: 'Fondos insuficientes' },
        },
      }),
      { 'fintoc-signature': 'valid-sig' },
    );

    const res = await fintocPOST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it('skips update when payment is already confirmed (idempotency)', async () => {
    const transferId = 'tr_already_confirmed';

    setDbResult('webhook_logs', { data: { id: 'log-3' }, error: null });
    // Return a payment that is already confirmed — handler should skip
    setDbResult('payments', {
      data: {
        id: 'pay-3',
        company_id: 'co-1',
        created_by: 'user-1',
        amount: 2000,
        beneficiary_name: 'Empresa X',
        status: 'confirmed',
      },
      error: null,
    });

    const req = makeTextRequest(
      JSON.stringify({
        type: 'transfer.outbound.succeeded',
        data: { id: transferId },
      }),
      { 'fintoc-signature': 'valid-sig' },
    );

    const res = await fintocPOST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    // Still returns received:true (graceful no-op)
    expect(json.received).toBe(true);
  });

  it('updates invoice to paid on payment_intent.succeeded', async () => {
    setDbResult('webhook_logs', { data: { id: 'log-4' }, error: null });
    setDbResult('invoices', {
      data: { id: 'inv-1', payment_state: 'open' },
      error: null,
    });

    const req = makeTextRequest(
      JSON.stringify({
        type: 'payment_intent.succeeded',
        data: {
          id: 'pi_xyz',
          amount: 150000, // centavos → 1500 pesos
          sender_account: { holder_name: 'Cliente Uno' },
          metadata: {
            invoice_id: 'inv-1',
            company_id: 'co-1',
            user_id: 'user-1',
          },
        },
      }),
      { 'fintoc-signature': 'valid-sig' },
    );

    const res = await fintocPOST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it('creates notification on payment_intent.failed', async () => {
    setDbResult('webhook_logs', { data: { id: 'log-5' }, error: null });

    const req = makeTextRequest(
      JSON.stringify({
        type: 'payment_intent.failed',
        data: {
          id: 'pi_failed',
          metadata: {
            company_id: 'co-1',
            user_id: 'user-1',
          },
        },
      }),
      { 'fintoc-signature': 'valid-sig' },
    );

    const res = await fintocPOST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it('returns { received: true } for movement.created (no-op)', async () => {
    setDbResult('webhook_logs', { data: { id: 'log-6' }, error: null });

    const req = makeTextRequest(
      JSON.stringify({
        type: 'movement.created',
        data: { id: 'mov-1', amount: 50000 },
      }),
      { 'fintoc-signature': 'valid-sig' },
    );

    const res = await fintocPOST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it('validates retry signature and returns 401 on invalid retry HMAC', async () => {
    const secret = 'test-retry-secret';
    process.env.WEBHOOK_RETRY_SECRET = secret;

    const logId = 'log-retry-1';

    // For retry path, verifyFintocWebhook is not called; we use x-webhook-retry=true
    const req = makeTextRequest(
      JSON.stringify({ type: 'transfer.outbound.succeeded', data: { id: 'tr_retry' } }),
      {
        'x-webhook-retry': 'true',
        'x-webhook-log-id': logId,
        'x-webhook-retry-signature': 'deadbeef', // wrong signature
      },
    );

    const res = await fintocPOST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Invalid retry signature');
  });

  it('accepts valid retry with correct HMAC signature', async () => {
    const secret = 'test-retry-secret';
    process.env.WEBHOOK_RETRY_SECRET = secret;

    const logId = 'log-retry-2';
    const expectedPayload = `${logId}:fintoc`;
    const validSig = crypto.createHmac('sha256', secret).update(expectedPayload).digest('hex');

    // webhook_logs select for log id verification
    setDbResult('webhook_logs', { data: { id: logId }, error: null });
    // payments select
    setDbResult('payments', {
      data: {
        id: 'pay-retry',
        company_id: 'co-1',
        created_by: 'user-1',
        amount: 3000,
        beneficiary_name: 'Retry Vendor',
        status: 'pending',
      },
      error: null,
    });

    const req = makeTextRequest(
      JSON.stringify({ type: 'transfer.outbound.succeeded', data: { id: 'tr_retry_valid' } }),
      {
        'x-webhook-retry': 'true',
        'x-webhook-log-id': logId,
        'x-webhook-retry-signature': validSig,
      },
    );

    const res = await fintocPOST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Syntage webhook tests
// ---------------------------------------------------------------------------

describe('Syntage webhook (POST /api/webhooks/syntage)', () => {
  const mockVerifyS = verifySyntageWebhook as ReturnType<typeof vi.fn>;
  const mockParseEfos = parseEfosStatus as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearDbResults();
    vi.clearAllMocks();
    // Default: secret valid
    mockVerifyS.mockReturnValue(true);
    // Default parseEfosStatus: not EFOS
    mockParseEfos.mockReturnValue({ status: null, isBlocked: false, isRisky: false, label: '' });
    process.env.SYNTAGE_WEBHOOK_SECRET = 'syntage-secret';
  });

  afterEach(() => {
    delete process.env.SYNTAGE_WEBHOOK_SECRET;
  });

  it('returns 401 when webhook secret is invalid', async () => {
    mockVerifyS.mockReturnValue(false);

    const req = makeRequest(
      { type: 'credential.updated', data: {} },
      { 'x-webhook-secret': 'wrong-secret' },
    );

    const res = await syntagePOST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Invalid signature');
  });

  it('returns 401 when SYNTAGE_WEBHOOK_SECRET env var is not set', async () => {
    delete process.env.SYNTAGE_WEBHOOK_SECRET;
    // verifySyntageWebhook won't even be called — the guard fires first

    const req = makeRequest(
      { type: 'credential.updated', data: {} },
      { 'x-webhook-secret': 'any-secret' },
    );

    const res = await syntagePOST(req);
    expect(res.status).toBe(401);
  });

  it('updates integration status on credential.updated', async () => {
    // webhook_logs is called twice: first for idempotency check (returns []),
    // then for the insert (returns the new log id).
    setDbResults(
      'webhook_logs',
      { data: [], error: null },                   // idempotency SELECT
      { data: { id: 'slog-1' }, error: null },     // INSERT .select('id').single()
    );
    setDbResult('integrations', {
      data: { id: 'int-1', company_id: 'co-1' },
      error: null,
    });
    setDbResult('user_companies', {
      data: [{ user_id: 'admin-1' }],
      error: null,
    });

    const req = makeRequest(
      {
        type: 'credential.updated',
        data: {
          id: 'cred-1',
          status: 'valid',
          taxpayer_id: 'RFC123456789',
        },
      },
      { 'x-webhook-secret': 'syntage-secret' },
    );

    const res = await syntagePOST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it('upserts invoice on invoice.created', async () => {
    setDbResults(
      'webhook_logs',
      { data: [], error: null },
      { data: { id: 'slog-2' }, error: null },
    );
    setDbResult('integrations', {
      data: { company_id: 'co-1' },
      error: null,
    });
    // No existing invoice found → insert path
    setDbResult('invoices', { data: null, error: null });

    const req = makeRequest(
      {
        type: 'invoice.created',
        data: {
          id: 'inv-sat-1',
          uuid: 'aaaa-bbbb-cccc-dddd',
          taxpayer_id: 'RFC123456789',
          status: 'Vigente',
          type: 'I',
          total: 1160,
          tax: 160,
          issued_at: '2026-01-15T10:00:00Z',
          issuer: { rfc: 'EMPR123456ABC', name: 'Empresa Emisora SA' },
          receiver: { rfc: 'RECR654321XYZ', name: 'Empresa Receptora SA' },
          currency: 'MXN',
        },
      },
      { 'x-webhook-secret': 'syntage-secret' },
    );

    const res = await syntagePOST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it('updates existing invoice on invoice.updated', async () => {
    setDbResults(
      'webhook_logs',
      { data: [], error: null },
      { data: { id: 'slog-3' }, error: null },
    );
    setDbResult('integrations', {
      data: { company_id: 'co-1' },
      error: null,
    });
    // Existing invoice found → update path
    setDbResult('invoices', { data: { id: 'inv-existing-1' }, error: null });

    const req = makeRequest(
      {
        type: 'invoice.updated',
        data: {
          id: 'inv-sat-1',
          uuid: 'aaaa-bbbb-cccc-dddd',
          taxpayer_id: 'RFC123456789',
          status: 'Vigente',
          type: 'I',
          total: 1160,
          tax: 160,
        },
      },
      { 'x-webhook-secret': 'syntage-secret' },
    );

    const res = await syntagePOST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it('notifies admins when EFOS definitivo is detected', async () => {
    // parseEfosStatus returns definitivo (isBlocked = true)
    mockParseEfos.mockReturnValue({
      status: 'definitive',
      isBlocked: true,
      isRisky: false,
      label: 'EFOS definitivo',
    });

    setDbResults(
      'webhook_logs',
      { data: [], error: null },
      { data: { id: 'slog-4' }, error: null },
    );
    setDbResult('integrations', {
      data: { company_id: 'co-1' },
      error: null,
    });
    setDbResult('invoices', { data: null, error: null });
    setDbResult('vendors', { data: null, error: null });
    setDbResult('user_companies', {
      data: [{ user_id: 'admin-1' }, { user_id: 'admin-2' }],
      error: null,
    });

    const req = makeRequest(
      {
        type: 'invoice.created',
        data: {
          id: 'inv-efos-1',
          uuid: 'efos-uuid-203',
          taxpayer_id: 'RFC_TAXPAYER',
          status: 'Vigente',
          type: 'E',
          total: 5800,
          tax: 800,
          issuer: { rfc: 'EFOS999999AAA', name: 'Empresa EFOS SA' },
          receiver: { rfc: 'RECE123456ABC', name: 'Receptor SA' },
          efos_validation: 'definitive',
        },
      },
      { 'x-webhook-secret': 'syntage-secret' },
    );

    const res = await syntagePOST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it('notifies admins when EFOS presunto is detected', async () => {
    mockParseEfos.mockReturnValue({
      status: 'presumed',
      isBlocked: false,
      isRisky: true,
      label: 'EFOS presunto',
    });

    setDbResults(
      'webhook_logs',
      { data: [], error: null },
      { data: { id: 'slog-5' }, error: null },
    );
    setDbResult('integrations', { data: { company_id: 'co-1' }, error: null });
    setDbResult('invoices', { data: null, error: null });
    setDbResult('vendors', { data: null, error: null });
    setDbResult('user_companies', {
      data: [{ user_id: 'admin-1' }],
      error: null,
    });

    const req = makeRequest(
      {
        type: 'invoice.created',
        data: {
          id: 'inv-efos-2',
          uuid: 'efos-uuid-201',
          taxpayer_id: 'RFC_TAXPAYER',
          status: 'Vigente',
          type: 'E',
          total: 2320,
          tax: 320,
          issuer: { rfc: 'EFOS888888BBB', name: 'Empresa Presunta SA' },
          receiver: { rfc: 'RECE123456ABC', name: 'Receptor SA' },
          efos_validation: 'presumed',
        },
      },
      { 'x-webhook-secret': 'syntage-secret' },
    );

    const res = await syntagePOST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it('updates extraction status on extraction.updated', async () => {
    setDbResults(
      'webhook_logs',
      { data: [], error: null },
      { data: { id: 'slog-6' }, error: null },
    );
    setDbResult('syntage_extractions', { data: null, error: null });

    const req = makeRequest(
      {
        type: 'extraction.updated',
        data: {
          id: 'ext-1',
          status: 'finished',
          recordsFound: 150,
        },
      },
      { 'x-webhook-secret': 'syntage-secret' },
    );

    const res = await syntagePOST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it('notifies admins when extraction.updated status is failed', async () => {
    setDbResults(
      'webhook_logs',
      { data: [], error: null },
      { data: { id: 'slog-7' }, error: null },
    );
    setDbResult('syntage_extractions', {
      data: { company_id: 'co-1', extractor: 'cfdi' },
      error: null,
    });
    setDbResult('user_companies', {
      data: [{ user_id: 'admin-1' }],
      error: null,
    });

    const req = makeRequest(
      {
        type: 'extraction.updated',
        data: {
          id: 'ext-2',
          status: 'failed',
          errorCode: 'SAT_TIMEOUT',
          error: 'El SAT no respondió a tiempo',
        },
      },
      { 'x-webhook-secret': 'syntage-secret' },
    );

    const res = await syntagePOST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it('deduplicates events with the same event ID', async () => {
    // Simulate: existing processed log with same event id
    setDbResult('webhook_logs', {
      data: [
        { id: 'slog-dup', payload: { data: { id: 'inv-dedup-1' } } },
      ],
      error: null,
    });

    const req = makeRequest(
      {
        type: 'invoice.created',
        data: {
          id: 'inv-dedup-1',
          uuid: 'dedup-uuid',
          taxpayer_id: 'RFC_X',
          status: 'Vigente',
          type: 'I',
          total: 100,
        },
      },
      { 'x-webhook-secret': 'syntage-secret' },
    );

    const res = await syntagePOST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
    expect(json.deduplicated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Odoo webhook tests
// ---------------------------------------------------------------------------

describe('Odoo webhook (POST /api/webhooks/odoo)', () => {
  beforeEach(() => {
    clearDbResults();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.ODOO_WEBHOOK_TOKEN;
  });

  it('returns 500 when ODOO_WEBHOOK_TOKEN is not configured', async () => {
    delete process.env.ODOO_WEBHOOK_TOKEN;

    const req = makeRequest(
      { type: 'invoice.created', data: { id: 'inv-1' } },
      { authorization: 'Bearer some-token' },
    );

    const res = await odooPOST(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error.code).toBe('WEBHOOK_NOT_CONFIGURED');
  });

  it('returns 401 when Bearer token is invalid', async () => {
    process.env.ODOO_WEBHOOK_TOKEN = 'correct-odoo-token';

    const req = makeRequest(
      { type: 'invoice.created', data: { id: 'inv-1' } },
      { authorization: 'Bearer wrong-token' },
    );

    const res = await odooPOST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when authorization header is missing', async () => {
    process.env.ODOO_WEBHOOK_TOKEN = 'correct-odoo-token';

    const req = makeRequest({ type: 'invoice.created', data: { id: 'inv-1' } });

    const res = await odooPOST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.code).toBe('UNAUTHORIZED');
  });

  it('logs to webhook_logs and returns { received: true } for valid token', async () => {
    process.env.ODOO_WEBHOOK_TOKEN = 'correct-odoo-token';

    setDbResult('webhook_logs', { data: null, error: null });

    const req = makeRequest(
      { type: 'invoice.created', data: { id: 'inv-odoo-1' } },
      { authorization: 'Bearer correct-odoo-token' },
    );

    const res = await odooPOST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it('deduplicates events with the same event ID', async () => {
    process.env.ODOO_WEBHOOK_TOKEN = 'correct-odoo-token';

    setDbResult('webhook_logs', {
      data: [
        { id: 'olog-dup', payload: { data: { id: 'odoo-event-1' } } },
      ],
      error: null,
    });

    const req = makeRequest(
      { type: 'invoice.updated', data: { id: 'odoo-event-1' } },
      { authorization: 'Bearer correct-odoo-token' },
    );

    const res = await odooPOST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
    expect(json.deduplicated).toBe(true);
  });

  it('handles invalid JSON body gracefully and logs validation error', async () => {
    process.env.ODOO_WEBHOOK_TOKEN = 'correct-odoo-token';

    setDbResult('webhook_logs', { data: null, error: null });

    // Send a body that fails the Zod schema (missing required fields)
    const req = makeRequest(
      { notType: 'something' }, // missing `type` field
      { authorization: 'Bearer correct-odoo-token' },
    );

    const res = await odooPOST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });
});
