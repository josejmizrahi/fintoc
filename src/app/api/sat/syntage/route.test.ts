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

const mockSyntageClient = {
  testConnection: vi.fn(),
  listCredentials: vi.fn(),
  getCredential: vi.fn(),
  listTaxpayers: vi.fn(),
  listInvoices: vi.fn(),
  getInvoice: vi.fn(),
  listTaxReturns: vi.fn(),
  listTaxComplianceChecks: vi.fn(),
  listExtractions: vi.fn(),
  listEvents: vi.fn(),
  createCredential: vi.fn(),
  deleteCredential: vi.fn(),
  createExtraction: vi.fn(),
  createExport: vi.fn(),
  createWebhook: vi.fn(),
  createEntity: vi.fn(),
};

vi.mock("@/lib/integrations/syntage", () => ({
  createSyntageClient: () => mockSyntageClient,
}));

const mockAdminFrom = vi.fn();
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
    from: vi.fn().mockImplementation((table: string) => {
      if (mockAdminFrom.mock.calls.length > 0 || table) {
        // Return chainable mock
      }
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.single = vi.fn().mockResolvedValue({
        data: table === "user_companies"
          ? { user_id: TEST_USER_ID, company_id: COMPANY_ID, role: "admin", is_active: true, status: "active" }
          : table === "companies"
            ? { rfc: "ABC010101AAA" }
            : table === "integrations"
              ? { syntage_taxpayer_id: "tp_123" }
              : null,
        error: null,
      });
      chain.insert = vi.fn().mockResolvedValue({ data: [{ id: 1 }], error: null });
      chain.update = vi.fn().mockReturnValue(chain);
      return chain;
    }),
  }),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/middleware/rate-limit", () => ({ checkRateLimit: vi.fn() }));

const ctx = { params: Promise.resolve({}) };

function makeGetRequest(params: Record<string, string>) {
  const url = new URL("http://localhost/api/sat/syntage");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString(), {
    headers: { cookie: `qb_access_token=${TEST_TOKEN}` },
  });
}

function makePostRequest(body: unknown) {
  return new Request("http://localhost/api/sat/syntage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: `qb_access_token=${TEST_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
}

describe("GET /api/sat/syntage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasDB.mockReturnValue(true);
    mockQuery.mockResolvedValue({
      data: { config: { syntageApiKey: "sk_syntage_123" } },
      error: null,
    });
  });

  it("returns 401 for unauthenticated requests", async () => {
    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/sat/syntage?action=status");
    const res = await GET(req, ctx);
    expect(res.status).toBe(401);
  });

  it("rejects missing action parameter", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeGetRequest({}), ctx);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.message).toContain("action");
  });

  it("returns 422 when Syntage not configured", async () => {
    mockQuery.mockResolvedValue({ data: { config: {} }, error: null });
    const { GET } = await import("./route");
    const res = await GET(makeGetRequest({ action: "status" }), ctx);
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error.code).toBe("INTEGRATION_NOT_CONFIGURED");
  });

  it("returns connection status", async () => {
    mockSyntageClient.testConnection.mockResolvedValue({ ok: true, version: "2.0" });
    const { GET } = await import("./route");
    const res = await GET(makeGetRequest({ action: "status" }), ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it("lists credentials", async () => {
    mockSyntageClient.listCredentials.mockResolvedValue({
      "hydra:member": [{ id: "cred_1", rfc: "ABC010101AAA" }],
      "hydra:totalItems": 1,
    });
    const { GET } = await import("./route");
    const res = await GET(makeGetRequest({ action: "credentials" }), ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.credentials).toHaveLength(1);
    expect(data.total).toBe(1);
  });

  it("lists taxpayers filtered by company RFC", async () => {
    mockSyntageClient.listTaxpayers.mockResolvedValue({
      "hydra:member": [
        { id: "tp_1", rfc: "ABC010101AAA", name: "My Company" },
        { id: "tp_2", rfc: "XYZ999999ZZZ", name: "Other Company" },
      ],
    });
    const { GET } = await import("./route");
    const res = await GET(makeGetRequest({ action: "taxpayers" }), ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.taxpayers).toHaveLength(1);
    expect(data.taxpayers[0].rfc).toBe("ABC010101AAA");
  });

  it("requires taxpayerId for invoices", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeGetRequest({ action: "invoices" }), ctx);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.message).toContain("taxpayerId");
  });

  it("rejects unknown action", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeGetRequest({ action: "nonexistent" }), ctx);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.message).toContain("desconocida");
  });
});

describe("POST /api/sat/syntage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasDB.mockReturnValue(true);
    mockQuery.mockResolvedValue({
      data: { config: { syntageApiKey: "sk_syntage_123" } },
      error: null,
    });
  });

  it("returns 401 for unauthenticated requests", async () => {
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/sat/syntage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "connect", rfc: "ABC", password: "123" }),
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(401);
  });

  it("rejects missing action", async () => {
    const { POST } = await import("./route");
    const res = await POST(makePostRequest({}), ctx);
    expect(res.status).toBe(400);
  });

  it("connects SAT credential", async () => {
    mockSyntageClient.createCredential.mockResolvedValue({ id: "cred_new", status: "valid" });
    const { POST } = await import("./route");
    const res = await POST(makePostRequest({
      action: "connect",
      rfc: "ABC010101AAA",
      password: "secret123",
    }), ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.credential.id).toBe("cred_new");
  });

  it("rejects connect without RFC and password", async () => {
    const { POST } = await import("./route");
    const res = await POST(makePostRequest({ action: "connect" }), ctx);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.message).toContain("RFC");
  });

  it("disconnects credential", async () => {
    mockSyntageClient.deleteCredential.mockResolvedValue(undefined);
    const { POST } = await import("./route");
    const res = await POST(makePostRequest({
      action: "disconnect",
      credentialId: "cred_123",
    }), ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it("creates extraction", async () => {
    mockSyntageClient.listTaxpayers.mockResolvedValue({ "hydra:member": [] });
    mockSyntageClient.createExtraction.mockResolvedValue({ id: "ext_1", status: "running" });
    const { POST } = await import("./route");
    const res = await POST(makePostRequest({
      action: "extract",
      taxpayerId: "tp_123",
      extractor: "invoice",
    }), ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.extraction.id).toBe("ext_1");
  });

  it("rejects unknown POST action", async () => {
    const { POST } = await import("./route");
    const res = await POST(makePostRequest({ action: "unknown-action" }), ctx);
    expect(res.status).toBe(400);
  });
});
