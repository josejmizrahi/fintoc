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

const mockCreateTransfer = vi.fn();
const mockVerifyCLABE = vi.fn();
const mockCreateAccountNumber = vi.fn();
const mockGetAccountNumber = vi.fn();

vi.mock("@/lib/integrations/fintoc", () => ({
  createTransfer: (...args: unknown[]) => mockCreateTransfer(...args),
  verifyCLABE: (...args: unknown[]) => mockVerifyCLABE(...args),
  createAccountNumber: (...args: unknown[]) => mockCreateAccountNumber(...args),
  getAccountNumber: (...args: unknown[]) => mockGetAccountNumber(...args),
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

const ctx = { params: Promise.resolve({}) };

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/fintoc", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: `qb_access_token=${TEST_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/fintoc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasDB.mockReturnValue(true);
    mockQuery.mockResolvedValue({
      data: { config: { secretKey: "sk_test_123" } },
      error: null,
    });
    mockUpdate.mockResolvedValue({ data: [{ id: 1 }], error: null });
  });

  it("returns 401 for unauthenticated requests", async () => {
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/fintoc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "verify-clabe", clabe: "012345678901234567" }),
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(401);
  });

  it("rejects when Fintoc not configured", async () => {
    mockQuery.mockResolvedValue({ data: { config: {} }, error: null });
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ action: "verify-clabe", clabe: "012345678901234567" }), ctx);
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error.code).toBe("INTEGRATION_NOT_CONFIGURED");
  });

  it("rejects invalid action", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ action: "invalid-action" }), ctx);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.message).toContain("invalida");
  });

  // ── outbound-transfer ──

  describe("outbound-transfer", () => {
    it("validates CLABE and amount are required", async () => {
      const { POST } = await import("./route");
      const res = await POST(makeRequest({ action: "outbound-transfer" }), ctx);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain("CLABE y monto");
    });

    it("validates CLABE format (18 digits)", async () => {
      const { POST } = await import("./route");
      const res = await POST(makeRequest({
        action: "outbound-transfer",
        clabe: "123",
        amount: 100,
      }), ctx);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain("18 digitos");
    });

    it("creates transfer and updates payment", async () => {
      mockCreateTransfer.mockResolvedValue({ id: "tr_123", status: "pending" });
      const { POST } = await import("./route");
      const res = await POST(makeRequest({
        action: "outbound-transfer",
        clabe: "012345678901234567",
        amount: 1500.50,
        payment_id: 42,
      }), ctx);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.transfer_id).toBe("tr_123");
      expect(data.data.status).toBe("pending");
      expect(mockCreateTransfer).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 150050, currency: "MXN" }),
        "sk_test_123",
        "pay-42",
      );
      expect(mockUpdate).toHaveBeenCalledWith(
        "payments",
        expect.objectContaining({ status: "processing", fintoc_transfer_id: "tr_123" }),
        expect.objectContaining({ id: 42, company_id: COMPANY_ID }),
      );
    });
  });

  // ── verify-clabe ──

  describe("verify-clabe", () => {
    it("validates CLABE format", async () => {
      const { POST } = await import("./route");
      const res = await POST(makeRequest({ action: "verify-clabe", clabe: "invalid" }), ctx);
      expect(res.status).toBe(400);
    });

    it("verifies CLABE and returns holder info", async () => {
      mockVerifyCLABE.mockResolvedValue({
        holder_name: "Juan Perez",
        institution: { name: "BBVA" },
      });
      const { POST } = await import("./route");
      const res = await POST(makeRequest({
        action: "verify-clabe",
        clabe: "012345678901234567",
      }), ctx);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.holder_name).toBe("Juan Perez");
      expect(data.data.bank).toBe("BBVA");
      expect(data.data.verified).toBe(true);
    });

    it("updates vendor when vendor_id provided", async () => {
      mockVerifyCLABE.mockResolvedValue({ holder_name: "Maria Lopez" });
      const { POST } = await import("./route");
      await POST(makeRequest({
        action: "verify-clabe",
        clabe: "012345678901234567",
        vendor_id: 10,
      }), ctx);
      expect(mockUpdate).toHaveBeenCalledWith(
        "vendors",
        expect.objectContaining({ clabe_verified: true, clabe_holder_name: "Maria Lopez" }),
        expect.objectContaining({ id: 10, company_id: COMPANY_ID }),
      );
    });
  });

  // ── create-account-number ──

  describe("create-account-number", () => {
    it("validates customer_id required", async () => {
      const { POST } = await import("./route");
      const res = await POST(makeRequest({ action: "create-account-number" }), ctx);
      expect(res.status).toBe(400);
    });

    it("returns 404 when customer not found", async () => {
      mockQuery.mockImplementation(async (table: string) => {
        if (table === "customers") return { data: null, error: null };
        return { data: { config: { secretKey: "sk_test_123" } }, error: null };
      });
      const { POST } = await import("./route");
      const res = await POST(makeRequest({ action: "create-account-number", customer_id: 999 }), ctx);
      expect(res.status).toBe(404);
    });

    it("returns existing CLABE if customer already has one", async () => {
      mockQuery.mockImplementation(async (table: string) => {
        if (table === "customers") {
          return { data: { id: 5, name: "Test", fintoc_account_number_id: "an_existing", fintoc_clabe: "111111111111111111" }, error: null };
        }
        return { data: { config: { secretKey: "sk_test_123" } }, error: null };
      });
      const { POST } = await import("./route");
      const res = await POST(makeRequest({ action: "create-account-number", customer_id: 5 }), ctx);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.account_number_id).toBe("an_existing");
    });

    it("creates new account number for customer", async () => {
      mockQuery.mockImplementation(async (table: string) => {
        if (table === "customers") {
          return { data: { id: 5, name: "Acme Corp" }, error: null };
        }
        return { data: { config: { secretKey: "sk_test_123" } }, error: null };
      });
      mockCreateAccountNumber.mockResolvedValue({ id: "an_new", number: "999888777666555444" });
      const { POST } = await import("./route");
      const res = await POST(makeRequest({ action: "create-account-number", customer_id: 5 }), ctx);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.account_number_id).toBe("an_new");
      expect(data.data.clabe).toBe("999888777666555444");
      expect(mockUpdate).toHaveBeenCalledWith(
        "customers",
        expect.objectContaining({ fintoc_account_number_id: "an_new" }),
        expect.objectContaining({ id: 5 }),
      );
    });
  });

  // ── get-account-number ──

  describe("get-account-number", () => {
    it("validates account_number_id required", async () => {
      const { POST } = await import("./route");
      const res = await POST(makeRequest({ action: "get-account-number" }), ctx);
      expect(res.status).toBe(400);
    });

    it("returns account number details", async () => {
      mockGetAccountNumber.mockResolvedValue({ id: "an_123", number: "012345678901234567", status: "active" });
      const { POST } = await import("./route");
      const res = await POST(makeRequest({ action: "get-account-number", account_number_id: "an_123" }), ctx);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.id).toBe("an_123");
    });
  });
});
