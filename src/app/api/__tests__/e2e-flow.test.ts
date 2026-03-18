/**
 * E2E Integration Tests
 *
 * Tests the full user flow: register → login → /me → dashboard → onboarding → company-switch → refresh
 * All Supabase calls are mocked at the admin client level to validate business logic end-to-end.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Shared mock state ──
const TEST_USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'; // UUID (Supabase Auth)
const TEST_EMAIL = 'test@example.com';
const TEST_COMPANY_ID = 5;   // Integer (database PK)
const TEST_COMPANY_ID_2 = 6; // Integer (database PK)
const TEST_TOKEN = 'valid-jwt-token';
const TEST_REFRESH_TOKEN = 'valid-refresh-token';

// Track what's in our "database"
let mockUserCompanies: Array<{
  user_id: string;
  company_id: number;
  role: string;
  is_active: boolean;
  status: string;
  companies?: Record<string, unknown>;
}> = [];

let mockCompanies: Array<{
  id: number;
  name: string;
  rfc: string;
  onboarding_completed: boolean;
}> = [];

let mockIntegrations: Array<Record<string, unknown>> = [];
let mockBankAccounts: Array<Record<string, unknown>> = [];
let mockInvoices: Array<Record<string, unknown>> = [];
let mockPayments: Array<Record<string, unknown>> = [];

// ── Supabase admin mock builder ──

function _createChainableMock(resolvedValue: unknown = { data: null, error: null }) {
  const methods = ['select', 'insert', 'update', 'delete', 'eq', 'gt', 'lt', 'neq', 'in', 'single', 'order', 'limit', 'maybeSingle'];

  function makeChain(finalValue: unknown) {
    const obj: Record<string, unknown> = {};
    for (const m of methods) {
      obj[m] = vi.fn().mockReturnValue(obj);
    }
    // 'single' and terminal methods should resolve with the value
    obj.single = vi.fn().mockResolvedValue(finalValue);
    // Make the chain itself thenable (for Promise.all patterns)
    obj.then = (resolve: (v: unknown) => void) => Promise.resolve(finalValue).then(resolve);
    return obj;
  }

  return makeChain(resolvedValue);
}

// Build a mock admin client that routes to our in-memory data
function buildMockAdmin() {
  const fromMock = vi.fn().mockImplementation((table: string) => {
    const chain = createQueryChain(table);
    return chain;
  });

  const admin = {
    from: fromMock,
    rpc: vi.fn().mockResolvedValue({ error: null }),
    auth: {
      admin: {
        createUser: vi.fn().mockImplementation(async ({ email }: { email: string; password: string }) => {
          return {
            data: {
              user: { id: TEST_USER_ID, email, user_metadata: {} },
            },
            error: null,
          };
        }),
        deleteUser: vi.fn().mockResolvedValue({ error: null }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
        generateLink: vi.fn().mockResolvedValue({ data: { properties: {} }, error: null }),
        getUserById: vi.fn().mockImplementation(async (id: string) => {
          if (id === TEST_USER_ID) {
            return {
              data: { user: { id: TEST_USER_ID, email: TEST_EMAIL, user_metadata: { full_name: 'Test User' } } },
              error: null,
            };
          }
          return { data: { user: null }, error: { message: 'User not found' } };
        }),
        listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
      },
      getUser: vi.fn().mockImplementation(async (token: string) => {
        if (token === TEST_TOKEN || token === 'new-access-token') {
          return {
            data: { user: { id: TEST_USER_ID, email: TEST_EMAIL, user_metadata: { full_name: 'Test User' } } },
            error: null,
          };
        }
        return { data: { user: null }, error: { message: 'Invalid token' } };
      }),
      signInWithPassword: vi.fn().mockResolvedValue({
        data: {
          session: { access_token: TEST_TOKEN, refresh_token: TEST_REFRESH_TOKEN },
          user: { id: TEST_USER_ID, email: TEST_EMAIL, user_metadata: {} },
        },
        error: null,
      }),
      refreshSession: vi.fn().mockResolvedValue({
        data: {
          session: { access_token: 'new-access-token', refresh_token: 'new-refresh-token', expires_at: Date.now() + 3600 },
        },
        error: null,
      }),
      setSession: vi.fn().mockResolvedValue({
        data: {
          session: { access_token: 'new-access-token', refresh_token: 'new-refresh-token', expires_at: Date.now() + 3600 },
        },
        error: null,
      }),
    },
  };

  return admin;
}

// Build a query chain that resolves based on table + filters
function createQueryChain(table: string) {
  const filters: Array<{ field: string; op: string; value: unknown }> = [];
  let _selectFields = '*';
  let _limitN = 100;
  let _orderField = '';
  let _orderAsc = true;
  let insertData: unknown = null;
  let _updateData: unknown = null;

  const resolveData = () => {
    if (table === 'user_companies') {
      let results = [...mockUserCompanies];
      for (const f of filters) {
        results = results.filter((r: Record<string, unknown>) => {
          if (f.op === 'eq') return r[f.field] === f.value;
          return true;
        });
      }
      return results;
    }
    if (table === 'companies') {
      let results = [...mockCompanies];
      for (const f of filters) {
        results = results.filter((r: Record<string, unknown>) => {
          if (f.op === 'eq') return r[f.field] === f.value;
          return true;
        });
      }
      return results;
    }
    if (table === 'bank_accounts') return [...mockBankAccounts];
    if (table === 'invoices') return [...mockInvoices];
    if (table === 'payments') return [...mockPayments];
    if (table === 'integrations') return [...mockIntegrations];
    return [];
  };

  const chain: Record<string, unknown> = {};

  chain.select = vi.fn().mockImplementation((fields?: string) => {
    _selectFields = fields || '*';
    return chain;
  });

  chain.insert = vi.fn().mockImplementation((data: unknown) => {
    insertData = data;
    if (table === 'companies') {
      const newCompany = { ...(data as Record<string, unknown>), id: TEST_COMPANY_ID };
      mockCompanies.push(newCompany as typeof mockCompanies[0]);
      (chain as Record<string, unknown>)._insertedData = newCompany;
    }
    if (table === 'user_companies') {
      mockUserCompanies.push(data as typeof mockUserCompanies[0]);
    }
    return chain;
  });

  chain.update = vi.fn().mockImplementation((data: unknown) => {
    _updateData = data;
    // Apply updates to in-memory data
    if (table === 'user_companies') {
      for (const uc of mockUserCompanies) {
        let matches = true;
        for (const f of filters) {
          if (f.op === 'eq' && (uc as Record<string, unknown>)[f.field] !== f.value) {
            matches = false;
          }
        }
        if (matches) {
          Object.assign(uc, data);
        }
      }
    }
    if (table === 'companies') {
      for (const c of mockCompanies) {
        let matches = true;
        for (const f of filters) {
          if (f.op === 'eq' && (c as Record<string, unknown>)[f.field] !== f.value) {
            matches = false;
          }
        }
        if (matches) {
          Object.assign(c, data);
        }
      }
    }
    return chain;
  });

  chain.delete = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockImplementation((field: string, value: unknown) => {
    filters.push({ field, op: 'eq', value });
    return chain;
  });
  chain.gt = vi.fn().mockReturnValue(chain);
  chain.lt = vi.fn().mockReturnValue(chain);
  chain.neq = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.or = vi.fn().mockReturnValue(chain);
  chain.not = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.lte = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.upsert = vi.fn().mockResolvedValue({ data: null, error: null });
  chain.order = vi.fn().mockImplementation((field: string, opts?: { ascending?: boolean }) => {
    _orderField = field;
    _orderAsc = opts?.ascending ?? true;
    return chain;
  });
  chain.limit = vi.fn().mockImplementation((n: number) => {
    _limitN = n;
    return chain;
  });

  chain.single = vi.fn().mockImplementation(async () => {
    const data = resolveData();
    if (insertData && table === 'companies') {
      return { data: (chain as Record<string, unknown>)._insertedData, error: null };
    }
    return data.length > 0 ? { data: data[0], error: null } : { data: null, error: { code: 'PGRST116' } };
  });

  chain.maybeSingle = vi.fn().mockImplementation(async () => {
    const data = resolveData();
    return { data: data[0] || null, error: null };
  });

  // Make chain thenable for Promise.all (used in dashboard)
  chain.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
    const data = resolveData();
    return Promise.resolve({ data, error: null }).then(resolve, reject);
  };

  return chain;
}

// ── Module mocks ──

const mockAdmin = buildMockAdmin();

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => mockAdmin,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockAdmin,
}));

vi.mock('@/lib/middleware/rate-limit', () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => mockAdmin,
}));

// ── Helpers ──

function makeRequest(method: string, url: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return new Request(`http://localhost${url}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

// ── Tests ──

describe('E2E Flow: Register → Login → Me → Dashboard → Onboarding → Company Switch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset in-memory data
    mockUserCompanies = [];
    mockCompanies = [];
    mockIntegrations = [];
    mockBankAccounts = [];
    mockInvoices = [];
    mockPayments = [];
  });

  describe('1. Registration', () => {
    it('creates user, company, and membership, sets auth cookies', async () => {
      vi.resetModules();
      const { POST } = await import('../auth/register/route');

      const req = makeRequest('POST', '/api/auth/register', {
        email: TEST_EMAIL,
        password: 'TestPass1234',
        full_name: 'Test User',
        company_name: 'Test Corp',
        rfc: 'XAXX010101000',
      });

      const res = await POST(req, { params: Promise.resolve({}) });
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.user.id).toBe(TEST_USER_ID);
      expect(data.user.email).toBe(TEST_EMAIL);
      expect(data.company).toBeDefined();
      expect(data.company.rfc).toBe('XAXX010101000');
      expect(data.role).toBe('admin');
      expect(data.onboarding_completed).toBe(false);
      // Tokens are now in httpOnly cookies
      const cookies = res.headers.getSetCookie();
      expect(cookies.some((c: string) => c.startsWith('qb_access_token='))).toBe(true);
    });

    it('rejects duplicate RFC', async () => {
      mockCompanies.push({ id: 999, name: 'Existing', rfc: 'XAXX010101000', onboarding_completed: true });

      vi.resetModules();
      const { POST } = await import('../auth/register/route');

      const req = makeRequest('POST', '/api/auth/register', {
        email: 'new@test.com',
        password: 'TestPass1234',
        full_name: 'New User',
        company_name: 'New Corp',
        rfc: 'XAXX010101000',
      });

      const res = await POST(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(409);
    });

    it('rejects weak password', async () => {
      vi.resetModules();
      const { POST } = await import('../auth/register/route');

      const req = makeRequest('POST', '/api/auth/register', {
        email: TEST_EMAIL,
        password: 'weak',
        full_name: 'Test User',
        company_name: 'Test Corp',
        rfc: 'XAXX010101000',
      });

      const res = await POST(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(400);
    });

    it('rejects invalid RFC format', async () => {
      vi.resetModules();
      const { POST } = await import('../auth/register/route');

      const req = makeRequest('POST', '/api/auth/register', {
        email: TEST_EMAIL,
        password: 'TestPass1234',
        full_name: 'Test User',
        company_name: 'Test Corp',
        rfc: 'INVALID',
      });

      const res = await POST(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(400);
    });
  });

  describe('2. Login', () => {
    beforeEach(() => {
      // Set up a registered user
      mockCompanies.push({ id: TEST_COMPANY_ID, name: 'Test Corp', rfc: 'XAXX010101000', onboarding_completed: false });
      mockUserCompanies.push({
        user_id: TEST_USER_ID,
        company_id: TEST_COMPANY_ID,
        role: 'admin',
        is_active: true,
        status: 'active',
        companies: { id: TEST_COMPANY_ID, name: 'Test Corp', rfc: 'XAXX010101000', onboarding_completed: false },
      });
    });

    it('returns user, company, token, and companies list', async () => {
      vi.resetModules();
      const { POST } = await import('../auth/login/route');

      const req = makeRequest('POST', '/api/auth/login', {
        email: TEST_EMAIL,
        password: 'TestPass1234',
      });

      const res = await POST(req, { params: Promise.resolve({}) });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.user.id).toBe(TEST_USER_ID);
      // Tokens are now in httpOnly cookies, not in response body
      const cookies = res.headers.getSetCookie();
      expect(cookies.some((c: string) => c.startsWith('qb_access_token='))).toBe(true);
      expect(cookies.some((c: string) => c.startsWith('qb_refresh_token='))).toBe(true);
      expect(data.company).toBeDefined();
      expect(data.companies).toBeDefined();
      expect(data.companies.length).toBeGreaterThanOrEqual(1);
      expect(data.role).toBe('admin');
    });

    it('auto-activates first company if none is active', async () => {
      // Mark company as not active
      mockUserCompanies[0].is_active = false;

      vi.resetModules();
      const { POST } = await import('../auth/login/route');

      const req = makeRequest('POST', '/api/auth/login', {
        email: TEST_EMAIL,
        password: 'TestPass1234',
      });

      const res = await POST(req, { params: Promise.resolve({}) });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.company).toBeDefined();
      // Should have called update to activate
      expect(mockAdmin.from).toHaveBeenCalledWith('user_companies');
    });

    it('rejects invalid credentials', async () => {
      mockAdmin.auth.signInWithPassword.mockResolvedValueOnce({
        data: { session: null, user: null },
        error: { message: 'Invalid login credentials' },
      });

      vi.resetModules();
      const { POST } = await import('../auth/login/route');

      const req = makeRequest('POST', '/api/auth/login', {
        email: TEST_EMAIL,
        password: 'wrong',
      });

      const res = await POST(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(401);
    });
  });

  describe('3. Auth /me endpoint', () => {
    beforeEach(() => {
      mockCompanies.push({ id: TEST_COMPANY_ID, name: 'Test Corp', rfc: 'XAXX010101000', onboarding_completed: false });
      mockUserCompanies.push({
        user_id: TEST_USER_ID,
        company_id: TEST_COMPANY_ID,
        role: 'admin',
        is_active: true,
        status: 'active',
        companies: { id: TEST_COMPANY_ID, name: 'Test Corp', rfc: 'XAXX010101000' },
      });
    });

    it('returns user info with companies', async () => {
      vi.resetModules();
      const { GET } = await import('../auth/me/route');

      const req = makeRequest('GET', '/api/auth/me', undefined, TEST_TOKEN);
      const res = await GET(req, { params: Promise.resolve({}) });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.data.id).toBe(TEST_USER_ID);
      expect(data.data.email).toBe(TEST_EMAIL);
      expect(data.data.companies).toBeDefined();
    });

    it('rejects without token', async () => {
      vi.resetModules();
      const { GET } = await import('../auth/me/route');

      const req = makeRequest('GET', '/api/auth/me');
      const res = await GET(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(401);
    });

    it('rejects with invalid token', async () => {
      vi.resetModules();
      const { GET } = await import('../auth/me/route');

      const req = makeRequest('GET', '/api/auth/me', undefined, 'invalid-token');
      const res = await GET(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(401);
    });
  });

  describe('4. Dashboard', () => {
    beforeEach(() => {
      mockUserCompanies.push({
        user_id: TEST_USER_ID,
        company_id: TEST_COMPANY_ID,
        role: 'admin',
        is_active: true,
        status: 'active',
      });
      mockBankAccounts.push({ balance: 50000, company_id: TEST_COMPANY_ID });
      mockBankAccounts.push({ balance: 25000, company_id: TEST_COMPANY_ID });
      mockInvoices.push({
        company_id: TEST_COMPANY_ID,
        type: 'receivable',
        amount_residual: 10000,
        due_date: '2025-01-01',
        status: 'open',
      });
      mockPayments.push({
        id: 'pay-1',
        company_id: TEST_COMPANY_ID,
        partner_name: 'Client A',
        amount: 5000,
        status: 'completed',
        direction: 'in',
        created_at: '2026-03-01',
      });
    });

    it('returns KPI data with correct structure', async () => {
      vi.resetModules();
      const { GET } = await import('../dashboard/route');

      const req = makeRequest('GET', '/api/dashboard', undefined, TEST_TOKEN);
      const res = await GET(req, { params: Promise.resolve({}) });
      const data = await res.json();

      expect(res.status).toBe(200);
      // Verify the response matches frontend expectations
      expect(data).toHaveProperty('total_balance');
      expect(data).toHaveProperty('accounts_receivable');
      expect(data).toHaveProperty('pending_invoices_count');
      expect(data).toHaveProperty('accounts_payable');
      expect(data).toHaveProperty('pending_bills_count');
      expect(data).toHaveProperty('overdue_amount');
      expect(data).toHaveProperty('overdue_invoices');
      expect(data).toHaveProperty('recent_payments');
      expect(data).toHaveProperty('overdue_invoice_list');
      expect(typeof data.total_balance).toBe('number');
      expect(Array.isArray(data.recent_payments)).toBe(true);
      expect(Array.isArray(data.overdue_invoice_list)).toBe(true);
    });

    it('rejects unauthenticated requests', async () => {
      vi.resetModules();
      const { GET } = await import('../dashboard/route');

      const req = makeRequest('GET', '/api/dashboard');
      const res = await GET(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(401);
    });
  });

  describe('5. Company Switch', () => {
    beforeEach(() => {
      mockCompanies.push(
        { id: TEST_COMPANY_ID, name: 'Corp A', rfc: 'XAXX010101000', onboarding_completed: true },
        { id: TEST_COMPANY_ID_2, name: 'Corp B', rfc: 'XBXX010101000', onboarding_completed: false },
      );
      mockUserCompanies.push(
        { user_id: TEST_USER_ID, company_id: TEST_COMPANY_ID, role: 'admin', is_active: true, status: 'active' },
        { user_id: TEST_USER_ID, company_id: TEST_COMPANY_ID_2, role: 'viewer', is_active: false, status: 'active' },
      );
    });

    it('switches active company and returns new company data', async () => {
      vi.resetModules();
      const { POST } = await import('../auth/switch-company/route');

      const req = makeRequest('POST', '/api/auth/switch-company', {
        company_id: TEST_COMPANY_ID_2,
      }, TEST_TOKEN);

      const res = await POST(req, { params: Promise.resolve({}) });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.data.active_company).toBeDefined();
      // Should have updated user_companies (deactivate old, activate new)
      expect(mockAdmin.from).toHaveBeenCalledWith('user_companies');
    });

    it('rejects switching to non-member company', async () => {
      vi.resetModules();
      const { POST } = await import('../auth/switch-company/route');

      const req = makeRequest('POST', '/api/auth/switch-company', {
        company_id: 999, // valid integer ID, but not a member
      }, TEST_TOKEN);

      const res = await POST(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(403);
    });

    it('rejects without auth', async () => {
      vi.resetModules();
      const { POST } = await import('../auth/switch-company/route');

      const req = makeRequest('POST', '/api/auth/switch-company', {
        company_id: TEST_COMPANY_ID_2,
      });

      const res = await POST(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(401);
    });
  });

  describe('6. Token Refresh', () => {
    it('returns new access and refresh tokens', async () => {
      vi.resetModules();
      const { POST } = await import('../auth/refresh/route');

      const req = makeRequest('POST', '/api/auth/refresh', {
        refresh_token: TEST_REFRESH_TOKEN,
      });

      const res = await POST(req, { params: Promise.resolve({}) });
      const _data = await res.json();

      expect(res.status).toBe(200);
      // Tokens are now in httpOnly cookies, not in response body
      const cookies = res.headers.getSetCookie();
      expect(cookies.some((c: string) => c.startsWith('qb_access_token='))).toBe(true);
      expect(cookies.some((c: string) => c.startsWith('qb_refresh_token='))).toBe(true);
    });

    it('rejects without refresh token', async () => {
      vi.resetModules();
      const { POST } = await import('../auth/refresh/route');

      const req = makeRequest('POST', '/api/auth/refresh', {});
      const res = await POST(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(400);
    });
  });

  describe('7. RBAC enforcement', () => {
    beforeEach(() => {
      mockUserCompanies.push({
        user_id: TEST_USER_ID,
        company_id: TEST_COMPANY_ID,
        role: 'viewer', // viewer, not admin
        is_active: true,
        status: 'active',
      });
    });

    it('viewer can read dashboard', async () => {
      vi.resetModules();
      const { GET } = await import('../dashboard/route');

      const req = makeRequest('GET', '/api/dashboard', undefined, TEST_TOKEN);
      const res = await GET(req, { params: Promise.resolve({}) });
      // viewer should have dashboard.read permission
      expect(res.status).toBe(200);
    });
  });

  describe('8. Edge cases', () => {
    it('handles empty JSON body gracefully on register', async () => {
      vi.resetModules();
      const { POST } = await import('../auth/register/route');

      const req = new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });

      const res = await POST(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(400);
    });

    it('handles malformed JSON body on login', async () => {
      vi.resetModules();
      const { POST } = await import('../auth/login/route');

      const req = new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      });

      const res = await POST(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(400);
    });

    it('handles user with no companies on login', async () => {
      // Don't add any user_companies
      mockAdmin.auth.signInWithPassword.mockResolvedValueOnce({
        data: {
          session: { access_token: TEST_TOKEN, refresh_token: TEST_REFRESH_TOKEN },
          user: { id: TEST_USER_ID, email: TEST_EMAIL, user_metadata: {} },
        },
        error: null,
      });

      vi.resetModules();
      const { POST } = await import('../auth/login/route');

      const req = makeRequest('POST', '/api/auth/login', {
        email: TEST_EMAIL,
        password: 'TestPass1234',
      });

      const res = await POST(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(403);
    });
  });
});
