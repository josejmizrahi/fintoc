import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
const mockHasDB = vi.fn();

vi.mock("@/lib/db", () => ({
  hasDB: () => mockHasDB(),
  query: (...args: unknown[]) => mockQuery(...args),
}));

const mockGetCompanyId = vi.fn();
vi.mock("@/lib/auth-helpers", () => ({
  getCompanyId: (...args: unknown[]) => mockGetCompanyId(...args),
}));

function makeRequest(searchParams?: Record<string, string>) {
  const url = new URL("http://localhost/api/sync-logs");
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) {
      url.searchParams.set(k, v);
    }
  }
  return new Request(url.toString(), {
    headers: { Authorization: "Bearer test-token" },
  });
}

describe("GET /api/sync-logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockHasDB.mockReturnValue(true);
    mockGetCompanyId.mockResolvedValue(1);
    mockQuery.mockResolvedValue({ data: [], error: null });
  });

  it("returns 401 for unauthenticated requests", async () => {
    mockGetCompanyId.mockResolvedValue(null);
    const { GET } = await import("./route");
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(401);
  });

  it("returns empty logs when no DB", async () => {
    mockHasDB.mockReturnValue(false);
    const { GET } = await import("./route");
    const res = await GET(makeRequest() as any);
    const data = await res.json();
    expect(data.logs).toEqual([]);
  });

  it("returns logs for company", async () => {
    const logs = [
      { id: 1, provider: "odoo", status: "success", started_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T00:01:00Z", processed_items: 50, total_items: 50 },
      { id: 2, provider: "odoo", status: "running", started_at: "2026-01-02T00:00:00Z", processed_items: 10, total_items: 100 },
    ];
    mockQuery.mockResolvedValue({ data: logs, error: null });

    const { GET } = await import("./route");
    const res = await GET(makeRequest() as any);
    const data = await res.json();

    expect(data.logs).toHaveLength(2);
    expect(data.logs[0].provider).toBe("odoo");
  });

  it("filters by provider when specified", async () => {
    const { GET } = await import("./route");
    await GET(makeRequest({ provider: "sat" }) as any);

    expect(mockQuery).toHaveBeenCalledWith("sync_logs", expect.objectContaining({
      match: { company_id: 1, provider: "sat" },
    }));
  });

  it("queries without provider filter when not specified", async () => {
    const { GET } = await import("./route");
    await GET(makeRequest() as any);

    expect(mockQuery).toHaveBeenCalledWith("sync_logs", expect.objectContaining({
      match: { company_id: 1 },
    }));
  });

  it("applies limit parameter with max of 100", async () => {
    const { GET } = await import("./route");
    await GET(makeRequest({ limit: "5" }) as any);

    expect(mockQuery).toHaveBeenCalledWith("sync_logs", expect.objectContaining({
      limit: 5,
    }));
  });

  it("caps limit at 100", async () => {
    const { GET } = await import("./route");
    await GET(makeRequest({ limit: "999" }) as any);

    expect(mockQuery).toHaveBeenCalledWith("sync_logs", expect.objectContaining({
      limit: 100,
    }));
  });

  it("uses default limit of 20", async () => {
    const { GET } = await import("./route");
    await GET(makeRequest() as any);

    expect(mockQuery).toHaveBeenCalledWith("sync_logs", expect.objectContaining({
      limit: 20,
    }));
  });

  it("orders by started_at descending", async () => {
    const { GET } = await import("./route");
    await GET(makeRequest() as any);

    expect(mockQuery).toHaveBeenCalledWith("sync_logs", expect.objectContaining({
      order: { column: "started_at", ascending: false },
    }));
  });
});
