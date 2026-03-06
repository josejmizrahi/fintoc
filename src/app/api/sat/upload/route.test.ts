import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

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

describe("POST /api/sat/upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasDB.mockReturnValue(true);
    mockGetCompanyId.mockResolvedValue(1);
    mockQuery.mockResolvedValue({ data: null, error: null });
    mockUpdate.mockResolvedValue({ data: [{ id: 1 }], error: null });
    mockInsert.mockResolvedValue({ data: [{ id: 1 }], error: null });
  });

  async function importRoute() {
    return await import("./route");
  }

  function createFormData(files: Record<string, { name: string; content: string; type?: string }>, fields?: Record<string, string>) {
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
      headers: { Authorization: "Bearer test-token" },
    });
  }

  it("rejects unauthenticated requests", async () => {
    mockGetCompanyId.mockResolvedValue(null);
    const { POST } = await importRoute();
    const formData = createFormData({ cer: { name: "cert.cer", content: "data" } });
    const req = createRequest(formData);

    const res = await POST(req as unknown as NextRequest);
    const data = await res.json();
    expect(res.status).toBe(401);
    expect(data.detail).toBe("No autorizado");
  });

  it("rejects when no files provided", async () => {
    const { POST } = await importRoute();
    const formData = new FormData();
    const req = createRequest(formData);

    const res = await POST(req as unknown as NextRequest);
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.detail).toContain("Se requiere al menos un archivo");
  });

  it("rejects .cer file with wrong extension", async () => {
    const { POST } = await importRoute();
    const formData = createFormData({ cer: { name: "cert.txt", content: "data" } });
    const req = createRequest(formData);

    const res = await POST(req as unknown as NextRequest);
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.detail).toContain(".cer");
  });

  it("rejects .key file with wrong extension", async () => {
    const { POST } = await importRoute();
    const formData = createFormData({ key: { name: "key.pem", content: "data" } });
    const req = createRequest(formData);

    const res = await POST(req as unknown as NextRequest);
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.detail).toContain(".key");
  });

  it("successfully uploads .cer file", async () => {
    const { POST } = await importRoute();
    const formData = createFormData(
      { cer: { name: "certificado.cer", content: "cert-binary-data" } },
      { rfcEmisor: "ABC010101AAA" },
    );
    const req = createRequest(formData);

    const res = await POST(req as unknown as NextRequest);
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.files.cer.name).toBe("certificado.cer");
    expect(data.files.key).toBeNull();
  });

  it("successfully uploads both .cer and .key files", async () => {
    const { POST } = await importRoute();
    const formData = createFormData({
      cer: { name: "sello.cer", content: "cert-data" },
      key: { name: "llave.key", content: "key-data" },
    });
    const req = createRequest(formData);

    const res = await POST(req as unknown as NextRequest);
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.files.cer.name).toBe("sello.cer");
    expect(data.files.key.name).toBe("llave.key");
    expect(data.message).toContain("sello.cer");
    expect(data.message).toContain("llave.key");
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

    const res = await POST(req as unknown as NextRequest);
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("passes keyPassword through to config", async () => {
    const { POST } = await importRoute();
    const formData = createFormData(
      { key: { name: "llave.key", content: "key-data" } },
      { keyPassword: "my-secret-password" },
    );
    const req = createRequest(formData);

    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
  });
});
