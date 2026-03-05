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
}));

// Mock odoo — createOdooClient returns a client with connect() and searchRead()
const mockSearchRead = vi.fn().mockResolvedValue([]);
const mockOdooCreate = vi.fn().mockResolvedValue(1);
vi.mock("@/lib/odoo", () => ({
  odooJsonRpc: vi.fn().mockResolvedValue({ jsonrpc: "2.0", result: { server_version: "17.0" } }),
  odooAuthenticate: vi.fn().mockResolvedValue(42),
  odooFetchAll: vi.fn().mockResolvedValue([]),
  odooSearchRead: mockSearchRead,
  createOdooClient: vi.fn().mockReturnValue({
    connect: vi.fn().mockResolvedValue(42),
    searchRead: mockSearchRead,
    create: mockOdooCreate,
    search: vi.fn().mockResolvedValue([]),
    write: vi.fn().mockResolvedValue(true),
    read: vi.fn().mockResolvedValue([]),
    fetchAll: vi.fn().mockResolvedValue([]),
    searchCount: vi.fn().mockResolvedValue(0),
    callAction: vi.fn().mockResolvedValue(null),
    findBankJournalId: vi.fn().mockResolvedValue(null),
  }),
  m2oId: (field: unknown) => (Array.isArray(field) ? field[0] : typeof field === "number" ? field : null),
  m2oName: (field: unknown) => (Array.isArray(field) ? field[1] : typeof field === "string" ? field : ""),
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

// Mock syntage
vi.mock("@/lib/syntage", () => ({
  createSyntageClient: vi.fn().mockReturnValue({
    getTaxpayers: vi.fn().mockResolvedValue([]),
    createExtraction: vi.fn().mockResolvedValue({ id: "ext-1", status: "completed" }),
    getExtraction: vi.fn().mockResolvedValue({ id: "ext-1", status: "completed", invoices: [] }),
  }),
}));

function makeRequest(method: string, body?: unknown) {
  return new Request("http://localhost/api/sync", {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("GET /api/sync", () => {
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

  it("returns sync logs", async () => {
    mockQuery.mockResolvedValue({
      data: [{ id: 1, provider: "odoo", status: "success" }],
      error: null,
    });
    const { GET } = await import("./route");
    const res = await GET(makeRequest("GET") as any);
    const data = await res.json();
    expect(data.logs).toHaveLength(1);
  });
});

describe("POST /api/sync", () => {
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
    const res = await POST(makeRequest("POST", { provider: "odoo" }) as any);
    expect(res.status).toBe(401);
  });

  it("rejects invalid provider", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", { provider: "invalid" }) as any);
    expect(res.status).toBe(400);
  });

  it("returns error when no config saved for provider", async () => {
    mockQuery.mockResolvedValue({ data: null, error: null });
    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", { provider: "odoo" }) as any);
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.message).toContain("configuracion");
  });

  // ── Sync Odoo ──

  it("creates sync_log when syncing Odoo", async () => {
    mockQuery.mockImplementation((table: string, opts?: any) => {
      if (table === "integrations" && opts?.single) {
        return { data: { id: 1, config: { url: "https://odoo.test.com", database: "db", user: "admin", password: "pass" } }, error: null };
      }
      return { data: null, error: null };
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", { provider: "odoo" }) as any);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.sync_log_id).toBeDefined();

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

  it("returns diff after Odoo sync", async () => {
    mockQuery.mockImplementation((table: string, opts?: any) => {
      if (table === "integrations" && opts?.single) {
        return { data: { id: 1, config: { url: "https://odoo.test.com", database: "db", user: "admin", password: "pass" } }, error: null };
      }
      return { data: null, error: null };
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", { provider: "odoo" }) as any);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.diff).toBeDefined();
  });

  // ── Sync SAT ──

  it("creates sync_log when syncing SAT (direct validation)", async () => {
    const invoices = [
      { id: 1, cfdi_uuid: "UUID-001", amount_total: 1000, type: "receivable" },
      { id: 2, cfdi_uuid: "UUID-002", amount_total: 2000, type: "receivable" },
    ];

    mockQuery.mockImplementation((table: string, opts?: any) => {
      if (table === "integrations" && opts?.single) {
        // No syntageApiKey → falls back to direct SAT validation
        return { data: { id: 1, config: { rfcEmisor: "ABC010101AAA" } }, error: null };
      }
      if (table === "invoices") return { data: invoices, error: null };
      return { data: null, error: null };
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", { provider: "sat" }) as any);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.sync_log_id).toBeDefined();
    expect(data.diff).toBeDefined();
  });

  // ── Sync Fintoc ──

  it("creates sync_log when syncing Fintoc", async () => {
    mockQuery.mockImplementation((table: string, opts?: any) => {
      if (table === "integrations" && opts?.single) {
        return { data: { id: 1, config: { secretKey: "sk_live_test" } }, error: null };
      }
      return { data: null, error: null };
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", { provider: "fintoc" }) as any);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.sync_log_id).toBeDefined();
  });

  it("returns error when Fintoc config has no secret key", async () => {
    mockQuery.mockImplementation((table: string, opts?: any) => {
      if (table === "integrations" && opts?.single) {
        return { data: { id: 1, config: { secretKey: "" } }, error: null };
      }
      return { data: null, error: null };
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest("POST", { provider: "fintoc" }) as any);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.message).toContain("Secret Key");
  });
});
