/**
 * Tests for expenses API routes — GET and PUT /api/expenses/[id]
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

// ── Mock: Supabase with call tracking ──
let fromCallIndex = 0;
const fromResults: Array<{ selectData?: unknown; updateData?: unknown; updateError?: unknown }> = [];

function setFromResults(...results: Array<{ selectData?: unknown; updateData?: unknown; updateError?: unknown }>) {
  fromCallIndex = 0;
  fromResults.length = 0;
  fromResults.push(...results);
}

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    from: () => {
      const idx = fromCallIndex++;
      const result = fromResults[idx] || {};

      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.single = vi.fn().mockImplementation(() =>
        Promise.resolve({ data: result.selectData ?? null })
      );
      chain.update = vi.fn().mockImplementation(() => {
        const updateChain: Record<string, unknown> = {};
        updateChain.eq = vi.fn().mockReturnValue(updateChain);
        updateChain.select = vi.fn().mockReturnValue(updateChain);
        updateChain.single = vi.fn().mockImplementation(() =>
          Promise.resolve({ data: result.updateData ?? null, error: result.updateError ?? null })
        );
        return updateChain;
      });
      return chain;
    },
  }),
}));

vi.mock('@/lib/utils/errors', () => ({
  ApiError: class ApiError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
}));

// ── Import routes ──
const { GET, PUT } = await import('./[id]/route');

// ── Helpers ──
function makeGetRequest(): Request {
  return new Request('http://localhost/api/expenses/exp-1', { method: 'GET' });
}

function makePutRequest(body: unknown): Request {
  return new Request('http://localhost/api/expenses/exp-1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const routeCtx = { params: Promise.resolve({ id: 'exp-1' }) };

describe('GET /api/expenses/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fromCallIndex = 0;
  });

  it('returns expense when found', async () => {
    const expense = { id: 'exp-1', amount: 5000, status: 'draft' };
    setFromResults({ selectData: expense });

    const res = await GET(makeGetRequest(), routeCtx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual(expense);
  });

  it('returns 404 when not found', async () => {
    setFromResults({ selectData: null });

    const res = await GET(makeGetRequest(), routeCtx);
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/expenses/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fromCallIndex = 0;
  });

  it('updates a draft expense successfully', async () => {
    const updated = { id: 'exp-1', amount: 6000, status: 'draft', description: 'Updated' };
    // First from() call: select existing status
    // Second from() call: update
    setFromResults(
      { selectData: { status: 'draft' } },
      { updateData: updated },
    );

    const res = await PUT(makePutRequest({ amount: 6000, description: 'Updated' }), routeCtx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual(updated);
  });

  it('updates a submitted expense successfully', async () => {
    const updated = { id: 'exp-1', amount: 3000, status: 'submitted' };
    setFromResults(
      { selectData: { status: 'submitted' } },
      { updateData: updated },
    );

    const res = await PUT(makePutRequest({ amount: 3000 }), routeCtx);
    expect(res.status).toBe(200);
  });

  it('rejects editing an approved expense', async () => {
    setFromResults({ selectData: { status: 'approved' } });

    const res = await PUT(makePutRequest({ amount: 3000 }), routeCtx);
    expect(res.status).toBe(422);
  });

  it('returns 404 when expense not found', async () => {
    setFromResults({ selectData: null });

    const res = await PUT(makePutRequest({ amount: 3000 }), routeCtx);
    expect(res.status).toBe(404);
  });

  it('returns 500 on database error', async () => {
    setFromResults(
      { selectData: { status: 'draft' } },
      { updateData: null, updateError: { message: 'DB error' } },
    );

    const res = await PUT(makePutRequest({ amount: 3000 }), routeCtx);
    expect(res.status).toBe(500);
  });
});
