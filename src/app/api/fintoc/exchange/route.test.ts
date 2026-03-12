import { describe, it, expect, vi, beforeEach } from "vitest";

const TEST_USER_ID = "u-test-user";
const TEST_TOKEN = "valid-jwt-token";
const COMPANY_ID = 1;

const mockQuery = vi.fn();
const mockUpdate = vi.fn();
const mockHasDB = vi.fn();

vi.mock("@/lib/db", () => ({
  hasDB: () => mockHasDB(),
  query: (...args: unknown[]) => mockQuery(...args),
  update: (...args: unknown[]) => mockUpdate(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    auth: {
      getUser: vi.fn().mockImplementation(async (token: string) => {
        if (token === TEST_TOKEN) {
          return { data: { user: { id: TEST_USER_ID, email: "test@test.com", user_metadata: {} } }, error: null };
        }
        return { data: { user: null }, error: { message: "Invalid token" } };
      }),
    },
    from: vi.fn().mockImplementation(() => {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.single = vi.fn().mockResolvedValue({
        data: { user_id: TEST_USER_ID, company_id: COMPANY_ID, role: "admin", is_active: true, status: "active" },
        error: null,
      });
      return chain;
    }),
  }),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/middleware/rate-limit", () => ({ checkRateLimit: vi.fn() }));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const ctx = { params: Promise.resolve({}) };

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/fintoc/exchange", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: `qb_access_token=${TEST_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/fintoc/exchange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasDB.mockReturnValue(true);
    mockQuery.mockResolvedValue({ data: { config: { secretKey: "sk_test_123" } }, error: null });
    mockUpdate.mockResolvedValue({ data: [{ id: 1 }], error: null });
    // Default mock fetch for Fintoc API
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("fintoc.com")) {
        return new Response(JSON.stringify({ link_token: "link_abc123", id: "lnk_abc" }), { status: 200 });
      }
      // Pass through to real fetch for local requests (withAuth cookie validation)
      return new Response(null, { status: 404 });
    });
  });

  it("returns 401 for unauthenticated requests", async () => {
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/fintoc/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exchange_token: "tok_123" }),
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(401);
  });

  it("rejects missing exchange_token", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest({}), ctx);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects when Fintoc secret key not configured", async () => {
    mockQuery.mockResolvedValue({ data: { config: {} }, error: null });
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ exchange_token: "tok_123" }), ctx);
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error.code).toBe("INTEGRATION_NOT_CONFIGURED");
  });

  it("exchanges token successfully", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ exchange_token: "tok_123" }), ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.link_token).toBe("link_abc123");
    expect(data.data.message).toContain("conectada");
    expect(mockUpdate).toHaveBeenCalledWith(
      "integrations",
      expect.objectContaining({ is_connected: true, status: "valid" }),
      expect.objectContaining({ company_id: COMPANY_ID, provider: "fintoc" }),
    );
  });

  it("returns 502 when Fintoc API fails", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("fintoc.com")) {
        return new Response(JSON.stringify({ error: { message: "Invalid token" } }), { status: 401 });
      }
      return new Response(null, { status: 404 });
    });
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ exchange_token: "bad_tok" }), ctx);
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error.code).toBe("FINTOC_ERROR");
    expect(data.error.message).toContain("Invalid token");
  });

  it("returns 502 when no link_token in response", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("fintoc.com")) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ exchange_token: "tok_123" }), ctx);
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error.message).toContain("link_token");
  });
});
