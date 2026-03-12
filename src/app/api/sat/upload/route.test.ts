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

const ctx = { params: Promise.resolve({}) };

describe("POST /api/sat/upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasDB.mockReturnValue(true);
    mockQuery.mockResolvedValue({ data: null, error: null });
    mockUpdate.mockResolvedValue({ data: [{ id: 1 }], error: null });
    mockInsert.mockResolvedValue({ data: [{ id: 1 }], error: null });
  });

  async function importRoute() {
    return await import("./route");
  }

  function createFormData(files: Record<string, { name: string; content: string }>, fields?: Record<string, string>) {
    const formData = new FormData();
    for (const [key, { name, content }] of Object.entries(files)) {
      const blob = new Blob([content], { type: "application/octet-stream" });
      formData.append(key, new File([blob], name));
    }
    if (fields) {
      for (const [key, value] of Object.entries(fields)) {
        formData.append(key, value);
      }
    }
    return formData;
  }

  function createRequest(formData: FormData) {
    return new Request("http://localhost/api/sat/upload", {
      method: "POST",
      body: formData,
      headers: { cookie: `qb_access_token=${TEST_TOKEN}` },
    });
  }

  it("rejects unauthenticated requests", async () => {
    const { POST } = await importRoute();
    const formData = createFormData({ cer: { name: "cert.cer", content: "data" } });
    const req = new Request("http://localhost/api/sat/upload", {
      method: "POST",
      body: formData,
    });

    const res = await POST(req, ctx);
    expect(res.status).toBe(401);
  });

  it("rejects when no files provided", async () => {
    const { POST } = await importRoute();
    const formData = new FormData();
    const req = createRequest(formData);

    const res = await POST(req, ctx);
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error.message).toContain("Se requiere al menos un archivo");
  });

  it("rejects .cer file with wrong extension", async () => {
    const { POST } = await importRoute();
    const formData = createFormData({ cer: { name: "cert.txt", content: "data" } });
    const req = createRequest(formData);

    const res = await POST(req, ctx);
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error.message).toContain(".cer");
  });

  it("rejects .key file with wrong extension", async () => {
    const { POST } = await importRoute();
    const formData = createFormData({ key: { name: "key.pem", content: "data" } });
    const req = createRequest(formData);

    const res = await POST(req, ctx);
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error.message).toContain(".key");
  });

  it("successfully uploads .cer file", async () => {
    const { POST } = await importRoute();
    const formData = createFormData(
      { cer: { name: "certificado.cer", content: "cert-binary-data" } },
      { rfcEmisor: "ABC010101AAA" },
    );
    const req = createRequest(formData);

    const res = await POST(req, ctx);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data.files.cer.name).toBe("certificado.cer");
    expect(data.data.files.key).toBeNull();
  });

  it("successfully uploads both .cer and .key files", async () => {
    const { POST } = await importRoute();
    const formData = createFormData({
      cer: { name: "sello.cer", content: "cert-data" },
      key: { name: "llave.key", content: "key-data" },
    });
    const req = createRequest(formData);

    const res = await POST(req, ctx);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data.files.cer.name).toBe("sello.cer");
    expect(data.data.files.key.name).toBe("llave.key");
    expect(data.data.message).toContain("sello.cer");
    expect(data.data.message).toContain("llave.key");
  });

  it("updates existing integration record", async () => {
    mockQuery.mockResolvedValue({
      data: { id: 1, config: { rfcEmisor: "OLD_RFC" } },
      error: null,
    });

    const { POST } = await importRoute();
    const formData = createFormData(
      { cer: { name: "cert.cer", content: "data" } },
      { rfcEmisor: "NEW010101AAA" },
    );
    const req = createRequest(formData);

    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("passes keyPassword through to config", async () => {
    const { POST } = await importRoute();
    const formData = createFormData(
      { key: { name: "llave.key", content: "key-data" } },
      { keyPassword: "my-secret-password" },
    );
    const req = createRequest(formData);

    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
  });
});
