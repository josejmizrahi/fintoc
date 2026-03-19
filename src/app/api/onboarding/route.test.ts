import { describe, it, expect, vi, beforeEach } from "vitest";

const TEST_USER_ID = "u-test-user";
const TEST_TOKEN = "valid-jwt-token";
const COMPANY_ID = 1;

const mockQuery = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockHasDB = vi.fn();

vi.mock("@/lib/db", () => ({
  hasDB: () => mockHasDB(),
  query: (...args: unknown[]) => mockQuery(...args),
  insert: (...args: unknown[]) => mockInsert(...args),
  update: (...args: unknown[]) => mockUpdate(...args),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getCompanyId: vi.fn(),
  maskConfig: vi.fn((c) => c),
  resolveConfig: vi.fn((a, b) => ({ ...b, ...a })),
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

vi.mock("@/lib/integrations/odoo", () => ({
  odooAuthenticate: vi.fn().mockResolvedValue(42),
  odooVersion: vi.fn().mockResolvedValue({ server_version: "17.0" }),
}));

vi.mock("@/lib/integrations/fintoc", () => ({
  getAccounts: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/utils/crypto", () => ({
  encrypt: vi.fn().mockReturnValue(Buffer.from("encrypted-data")),
}));

function makeRequest(method: string, body?: unknown) {
  return new Request("http://localhost/api/onboarding", {
    method,
    headers: {
      "Content-Type": "application/json",
      cookie: `qb_access_token=${TEST_TOKEN}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

const ctx = { params: Promise.resolve({}) };

describe("GET /api/onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasDB.mockReturnValue(true);
    mockQuery.mockResolvedValue({ data: [], error: null });
  });

  it("returns 401 for unauthenticated requests", async () => {
    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/onboarding", { method: "GET" });
    const res = await GET(req, ctx);
    expect(res.status).toBe(401);
  });

  it("returns empty integrations when no DB", async () => {
    mockHasDB.mockReturnValue(false);
    const { GET } = await import("./route");
    const res = await GET(makeRequest("GET"), ctx);
    const data = await res.json();
    expect(data.integrations.odoo).toBeNull();
    expect(data.integrations.fintoc).toBeNull();
    expect(data.integrations.sat).toBeNull();
    expect(data.onboarding_completed).toBe(false);
  });

  it("returns integration statuses from DB", async () => {
    mockQuery.mockImplementation((table: string) => {
      if (table === "integrations") {
        return {
          data: [
            { provider: "odoo", is_connected: true, last_sync_at: "2026-01-01", last_sync_status: "success", last_sync_message: "OK", config: { url: "https://odoo.test.com" } },
          ],
          error: null,
        };
      }
      if (table === "companies") {
        return { data: { onboarding_completed: true }, error: null };
      }
      return { data: null, error: null };
    });

    const { GET } = await import("./route");
    const res = await GET(makeRequest("GET"), ctx);
    const data = await res.json();

    expect(data.integrations.odoo.is_connected).toBe(true);
    expect(data.integrations.odoo.last_sync_status).toBe("success");
    expect(data.onboarding_completed).toBe(true);
  });
});

describe("POST /api/onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockHasDB.mockReturnValue(true);
    mockQuery.mockResolvedValue({ data: null, error: null });
    mockInsert.mockResolvedValue({ data: [{ id: 1 }], error: null });
    mockUpdate.mockResolvedValue({ data: [{ id: 1 }], error: null });
  });

  it("returns 401 for unauthenticated requests", async () => {
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save", provider: "odoo", config: { url: "x" } }),
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(401);
  });

  it("rejects invalid provider", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", { action: "save", provider: "invalid", config: { x: "y" } }), ctx);
    expect(res.status).toBe(400);
  });

  it("saves new integration config", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", {
      action: "save",
      provider: "odoo",
      config: { url: "https://odoo.test.com", database: "db", user: "admin", password: "pass" },
    }), ctx);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(mockInsert).toHaveBeenCalledWith("integrations", expect.objectContaining({
      company_id: COMPANY_ID,
      provider: "odoo",
    }));
  });

  it("updates existing integration config", async () => {
    mockQuery.mockResolvedValue({
      data: { id: 1, config: { url: "https://old.com" } },
      error: null,
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", {
      action: "save",
      provider: "odoo",
      config: { url: "https://new.com" },
    }), ctx);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("marks onboarding as complete", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", { action: "complete" }), ctx);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith("companies", { onboarding_completed: true }, { id: COMPANY_ID });
  });

  it("tests Odoo connection successfully", async () => {
    mockQuery.mockResolvedValue({ data: { id: 1, config: {} }, error: null });

    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", {
      action: "test",
      provider: "odoo",
      config: { url: "https://odoo.test.com", database: "db", user: "admin", password: "pass" },
    }), ctx);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.message).toContain("Odoo");
  });

  it("returns error when Odoo fields missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", {
      action: "test",
      provider: "odoo",
      config: { url: "", database: "", user: "", password: "" },
    }), ctx);

    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.message).toContain("Faltan campos");
  });

  it("tests SAT configuration with valid RFC but no API key returns warning", async () => {
    mockQuery.mockResolvedValue({
      data: { id: 1, config: { certBase64: "abc", keyBase64: "def" } },
      error: null,
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", {
      action: "test",
      provider: "sat",
      config: { rfcEmisor: "ABC010101AAA" },
    }), ctx);

    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.message).toContain("ABC010101AAA");
  });

  it("rejects invalid RFC format", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", {
      action: "test",
      provider: "sat",
      config: { rfcEmisor: "INVALID" },
    }), ctx);

    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.message).toContain("RFC invalido");
  });

  it("returns error when RFC missing for SAT test", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", {
      action: "test",
      provider: "sat",
      config: { rfcEmisor: "" },
    }), ctx);

    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.message).toContain("RFC");
  });

  it("rejects sync action (moved to /api/sync)", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", {
      action: "sync",
      provider: "odoo",
      config: { url: "https://odoo.test.com", database: "db", user: "admin", password: "pass" },
    }), ctx);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });
});
