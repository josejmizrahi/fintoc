import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db module
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

// Mock auth-helpers
const mockGetCompanyId = vi.fn();
vi.mock("@/lib/auth-helpers", () => ({
  getCompanyId: (...args: unknown[]) => mockGetCompanyId(...args),
  maskConfig: vi.fn((c) => c),
  resolveConfig: vi.fn((a, b) => ({ ...b, ...a })),
}));

// Mock odoo (integrations client)
vi.mock("@/lib/integrations/odoo", () => ({
  odooAuthenticate: vi.fn().mockResolvedValue(42),
  odooVersion: vi.fn().mockResolvedValue({ server_version: "17.0" }),
}));

// Mock fintoc (integrations client)
vi.mock("@/lib/integrations/fintoc", () => ({
  getAccounts: vi.fn().mockResolvedValue([]),
}));

function makeRequest(method: string, body?: unknown) {
  return new Request("http://localhost/api/onboarding", {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("GET /api/onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasDB.mockReturnValue(true);
    mockGetCompanyId.mockResolvedValue(1);
    mockQuery.mockResolvedValue({ data: [], error: null });
  });

  it("returns 401 for unauthenticated requests", async () => {
    mockGetCompanyId.mockResolvedValue(null);
    const { GET } = await import("./route");
    const res = await GET(makeRequest("GET") as any);
    expect(res.status).toBe(401);
  });

  it("returns empty integrations when no DB", async () => {
    mockHasDB.mockReturnValue(false);
    const { GET } = await import("./route");
    const res = await GET(makeRequest("GET") as any);
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
    const res = await GET(makeRequest("GET") as any);
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
    mockGetCompanyId.mockResolvedValue(1);
    mockQuery.mockResolvedValue({ data: null, error: null });
    mockInsert.mockResolvedValue({ data: [{ id: 1 }], error: null });
    mockUpdate.mockResolvedValue({ data: [{ id: 1 }], error: null });
  });

  it("returns 401 for unauthenticated requests", async () => {
    mockGetCompanyId.mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", { action: "save", provider: "odoo" }) as any);
    expect(res.status).toBe(401);
  });

  it("returns 500 when no DB configured", async () => {
    mockHasDB.mockReturnValue(false);
    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", { action: "save", provider: "odoo" }) as any);
    expect(res.status).toBe(500);
  });

  it("rejects invalid provider", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", { action: "save", provider: "invalid" }) as any);
    expect(res.status).toBe(400);
  });

  // ── Save action ──

  it("saves new integration config", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", {
      action: "save",
      provider: "odoo",
      config: { url: "https://odoo.test.com", database: "db", user: "admin", password: "pass" },
    }) as any);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(mockInsert).toHaveBeenCalledWith("integrations", expect.objectContaining({
      company_id: 1,
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
    }) as any);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalled();
  });

  // ── Complete action ──

  it("marks onboarding as complete", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", { action: "complete" }) as any);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith("companies", { onboarding_completed: true }, { id: 1 });
  });

  // ── Test Odoo ──

  it("tests Odoo connection successfully", async () => {
    mockQuery.mockResolvedValue({ data: { id: 1, config: {} }, error: null });

    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", {
      action: "test",
      provider: "odoo",
      config: { url: "https://odoo.test.com", database: "db", user: "admin", password: "pass" },
    }) as any);

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
    }) as any);

    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.message).toContain("Faltan campos");
  });

  // ── Test SAT ──

  it("tests SAT configuration with valid RFC", async () => {
    mockQuery.mockResolvedValue({
      data: { id: 1, config: { certBase64: "abc", keyBase64: "def" } },
      error: null,
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", {
      action: "test",
      provider: "sat",
      config: { rfcEmisor: "ABC010101AAA" },
    }) as any);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.message).toContain("ABC010101AAA");
    expect(data.certificates).toBeDefined();
    expect(data.certificates.cer).toBe(true);
    expect(data.certificates.key).toBe(true);
  });

  it("rejects invalid RFC format", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", {
      action: "test",
      provider: "sat",
      config: { rfcEmisor: "INVALID" },
    }) as any);

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
    }) as any);

    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.message).toContain("RFC");
  });

  // ── Sync action is now handled by /api/sync ──

  it("rejects sync action (moved to /api/sync)", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", {
      action: "sync",
      provider: "odoo",
      config: { url: "https://odoo.test.com", database: "db", user: "admin", password: "pass" },
    }) as any);

    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.detail).toContain("invalida");
  });
});
