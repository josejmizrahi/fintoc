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

// Mock odoo
vi.mock("@/lib/odoo", () => ({
  odooJsonRpc: vi.fn().mockResolvedValue({ jsonrpc: "2.0", result: { server_version: "17.0" } }),
  odooAuthenticate: vi.fn().mockResolvedValue(42),
  odooFetchAll: vi.fn().mockResolvedValue([]),
}));

// Mock fintoc
vi.mock("@/lib/fintoc", () => ({
  fintocGet: vi.fn().mockResolvedValue([]),
}));

// Mock sat
vi.mock("@/lib/sat", () => ({
  validateCfdiAgainstSat: vi.fn().mockResolvedValue("Vigente"),
  testSatReachability: vi.fn().mockResolvedValue(true),
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

  // ── Sync Odoo (with sync_logs) ──

  it("creates sync_log when syncing Odoo", async () => {
    mockQuery.mockResolvedValue({ data: null, error: null });

    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", {
      action: "sync",
      provider: "odoo",
      config: { url: "https://odoo.test.com", database: "db", user: "admin", password: "pass" },
    }) as any);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.sync_log_id).toBeDefined();

    // Verify sync_log was created
    const syncLogInsert = mockInsert.mock.calls.find(
      (call) => call[0] === "sync_logs",
    );
    expect(syncLogInsert).toBeDefined();
    expect(syncLogInsert![1]).toMatchObject({
      company_id: 1,
      provider: "odoo",
      sync_type: "full",
      status: "running",
    });
  });

  it("returns sync counts after Odoo sync", async () => {
    mockQuery.mockResolvedValue({ data: null, error: null });

    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", {
      action: "sync",
      provider: "odoo",
      config: { url: "https://odoo.test.com", database: "db", user: "admin", password: "pass" },
    }) as any);

    const data = await res.json();
    expect(data.synced).toBeDefined();
    expect(data.synced).toHaveProperty("customers");
    expect(data.synced).toHaveProperty("vendors");
    expect(data.synced).toHaveProperty("invoices");
    expect(data.synced).toHaveProperty("payments");
  });

  // ── Sync SAT (with sync_logs) ──

  it("creates sync_log when syncing SAT", async () => {
    const invoices = [
      { id: 1, cfdi_uuid: "UUID-001", amount_total: 1000 },
      { id: 2, cfdi_uuid: "UUID-002", amount_total: 2000 },
    ];

    mockQuery.mockImplementation((table: string) => {
      if (table === "integrations") return { data: null, error: null };
      if (table === "invoices") return { data: invoices, error: null };
      return { data: null, error: null };
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", {
      action: "sync",
      provider: "sat",
      config: { rfcEmisor: "ABC010101AAA" },
    }) as any);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.validated).toBe(2);
    expect(data.vigentes).toBe(2); // Both return "Vigente" from mock
    expect(data.sync_log_id).toBeDefined();

    // Verify sync_log was created with correct total_items
    const syncLogInsert = mockInsert.mock.calls.find(
      (call) => call[0] === "sync_logs",
    );
    expect(syncLogInsert).toBeDefined();
    expect(syncLogInsert![1].total_items).toBe(2);
  });

  // ── Sync Fintoc (with sync_logs) ──

  it("creates sync_log when syncing Fintoc", async () => {
    mockQuery.mockResolvedValue({ data: null, error: null });

    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", {
      action: "sync",
      provider: "fintoc",
      config: { secretKey: "sk_live_test" },
    }) as any);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.sync_log_id).toBeDefined();
  });

  it("returns error when Fintoc secret key missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", {
      action: "sync",
      provider: "fintoc",
      config: { secretKey: "" },
    }) as any);

    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.message).toContain("Secret Key");
  });
});
