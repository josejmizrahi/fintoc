import { describe, it, expect, vi, beforeEach } from "vitest";

const TEST_USER_ID = "u-test-user";
const TEST_TOKEN = "valid-jwt-token";
const COMPANY_ID = 1;

const mockQuery = vi.fn();
const mockHasDB = vi.fn();

vi.mock("@/lib/db", () => ({
  hasDB: () => mockHasDB(),
  query: (...args: unknown[]) => mockQuery(...args),
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

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({}),
}));

vi.mock("@/lib/middleware/rate-limit", () => ({
  checkRateLimit: vi.fn(),
}));

function makeRequest(searchParams?: Record<string, string>) {
  const url = new URL("http://localhost/api/sync-logs");
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) {
      url.searchParams.set(k, v);
    }
  }
  return new Request(url.toString(), {
    headers: { cookie: `qb_access_token=${TEST_TOKEN}` },
  });
}

const ctx = { params: Promise.resolve({}) };

describe("GET /api/sync-logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockHasDB.mockReturnValue(true);
    mockQuery.mockResolvedValue({ data: [], error: null });
  });

  it("returns 401 for unauthenticated requests", async () => {
    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/sync-logs");
    const res = await GET(req, ctx);
    expect(res.status).toBe(401);
  });

  it("returns empty data when no DB", async () => {
    mockHasDB.mockReturnValue(false);
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), ctx);
    const data = await res.json();
    expect(data.data).toEqual([]);
  });

  it("returns logs for company", async () => {
    const logs = [
      { id: "1", provider: "odoo", status: "completed", started_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T00:01:00Z", records_synced: 50 },
      { id: "2", provider: "odoo", status: "running", started_at: "2026-01-02T00:00:00Z", records_synced: 10 },
    ];
    mockQuery.mockResolvedValue({ data: logs, error: null });

    const { GET } = await import("./route");
    const res = await GET(makeRequest(), ctx);
    const data = await res.json();

    expect(data.data).toHaveLength(2);
    expect(data.data[0].provider).toBe("odoo");
  });

  it("filters by provider when specified", async () => {
    const { GET } = await import("./route");
    await GET(makeRequest({ provider: "sat" }), ctx);

    expect(mockQuery).toHaveBeenCalledWith("sync_history", expect.objectContaining({
      match: { company_id: COMPANY_ID, provider: "sat" },
    }));
  });

  it("queries without provider filter when not specified", async () => {
    const { GET } = await import("./route");
    await GET(makeRequest(), ctx);

    expect(mockQuery).toHaveBeenCalledWith("sync_history", expect.objectContaining({
      match: { company_id: COMPANY_ID },
    }));
  });

  it("applies limit parameter with max of 100", async () => {
    const { GET } = await import("./route");
    await GET(makeRequest({ limit: "5" }), ctx);

    expect(mockQuery).toHaveBeenCalledWith("sync_history", expect.objectContaining({
      limit: 5,
    }));
  });

  it("caps limit at 100", async () => {
    const { GET } = await import("./route");
    await GET(makeRequest({ limit: "999" }), ctx);

    expect(mockQuery).toHaveBeenCalledWith("sync_history", expect.objectContaining({
      limit: 100,
    }));
  });

  it("uses default limit of 20", async () => {
    const { GET } = await import("./route");
    await GET(makeRequest(), ctx);

    expect(mockQuery).toHaveBeenCalledWith("sync_history", expect.objectContaining({
      limit: 20,
    }));
  });

  it("orders by started_at descending", async () => {
    const { GET } = await import("./route");
    await GET(makeRequest(), ctx);

    expect(mockQuery).toHaveBeenCalledWith("sync_history", expect.objectContaining({
      order: { column: "started_at", ascending: false },
    }));
  });
});
