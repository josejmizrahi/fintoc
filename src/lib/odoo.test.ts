import { describe, it, expect, vi, beforeEach } from "vitest";
import { odooJsonRpc, odooAuthenticate, odooSearchRead, odooFetchAll } from "./odoo";

describe("odooJsonRpc", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends correct JSON-RPC payload", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: "2.0", result: { server_version: "17.0" } }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await odooJsonRpc("https://odoo.test.com", "common", "version", []);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://odoo.test.com/jsonrpc");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(opts.body);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("call");
    expect(body.params.service).toBe("common");
    expect(body.params.method).toBe("version");
    expect(body.params.args).toEqual([]);
  });

  it("strips trailing slash from URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: "2.0", result: null }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await odooJsonRpc("https://odoo.test.com/", "common", "version", []);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://odoo.test.com/jsonrpc");
  });

  it("throws on non-ok HTTP response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
    }));

    await expect(odooJsonRpc("https://odoo.test.com", "common", "version", []))
      .rejects.toThrow("HTTP 502");
  }, 15000);

  it("returns parsed JSON-RPC response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        jsonrpc: "2.0",
        result: { server_version: "17.0" },
      }),
    }));

    const result = await odooJsonRpc("https://odoo.test.com", "common", "version", []);
    expect(result.result).toEqual({ server_version: "17.0" });
  });
});

describe("odooAuthenticate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns UID on successful authentication", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: "2.0", result: 42 }),
    }));

    const uid = await odooAuthenticate("https://odoo.test.com", "mydb", "admin", "pass");
    expect(uid).toBe(42);
  });

  it("throws on invalid credentials (result = false)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: "2.0", result: false }),
    }));

    await expect(odooAuthenticate("https://odoo.test.com", "mydb", "admin", "wrong"))
      .rejects.toThrow("Credenciales invalidas");
  });

  it("throws on JSON-RPC error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        jsonrpc: "2.0",
        error: { message: "Access denied", data: { message: "Database does not exist" } },
      }),
    }));

    await expect(odooAuthenticate("https://odoo.test.com", "baddb", "admin", "pass"))
      .rejects.toThrow("Database does not exist");
  });

  it("passes correct args to JSON-RPC", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: "2.0", result: 1 }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await odooAuthenticate("https://odoo.test.com", "testdb", "user@test.com", "secret123");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params.args).toEqual(["testdb", "user@test.com", "secret123", {}]);
  });
});

describe("odooSearchRead", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns array of records", async () => {
    const records = [
      { id: 1, name: "Customer A", vat: "RFC001" },
      { id: 2, name: "Customer B", vat: "RFC002" },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: "2.0", result: records }),
    }));

    const result = await odooSearchRead(
      "https://odoo.test.com", "db", 1, "pass",
      "res.partner", [["customer_rank", ">", 0]], ["id", "name", "vat"],
    );
    expect(result).toEqual(records);
    expect(result).toHaveLength(2);
  });

  it("passes correct domain and fields", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: "2.0", result: [] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await odooSearchRead(
      "https://odoo.test.com", "mydb", 5, "pass",
      "account.move",
      [["move_type", "in", ["out_invoice", "in_invoice"]]],
      ["id", "name", "amount_total"],
      100, 50,
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params.args[3]).toBe("account.move");
    expect(body.params.args[4]).toBe("search_read");
    expect(body.params.args[5]).toEqual([[["move_type", "in", ["out_invoice", "in_invoice"]]]]);
    expect(body.params.args[6]).toEqual({ fields: ["id", "name", "amount_total"], limit: 100, offset: 50 });
  });

  it("returns empty array when result is null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: "2.0", result: null }),
    }));

    const result = await odooSearchRead(
      "https://odoo.test.com", "db", 1, "pass",
      "res.partner", [], [],
    );
    expect(result).toEqual([]);
  });

  it("throws on JSON-RPC error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        jsonrpc: "2.0",
        error: { message: "Access denied" },
      }),
    }));

    await expect(odooSearchRead(
      "https://odoo.test.com", "db", 1, "pass",
      "res.partner", [], [],
    )).rejects.toThrow("Access denied");
  });
});

describe("odooFetchAll", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches single page when results < PAGE size", async () => {
    const records = Array.from({ length: 3 }, (_, i) => ({ id: i + 1, name: `Record ${i + 1}` }));
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: "2.0", result: records }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await odooFetchAll(
      "https://odoo.test.com", "db", 1, "pass",
      "res.partner", [], ["id", "name"],
    );

    expect(result).toEqual(records);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("paginates when results fill entire page", async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => ({ id: i + 1 }));
    const page2 = Array.from({ length: 200 }, (_, i) => ({ id: i + 501 }));
    let callCount = 0;

    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          jsonrpc: "2.0",
          result: callCount === 1 ? page1 : page2,
        }),
      });
    }));

    const result = await odooFetchAll(
      "https://odoo.test.com", "db", 1, "pass",
      "res.partner", [], ["id"],
    );

    expect(result).toHaveLength(700);
    expect(result[0].id).toBe(1);
    expect(result[699].id).toBe(700);
  });

  it("respects maxRecords limit", async () => {
    const page = Array.from({ length: 500 }, (_, i) => ({ id: i + 1 }));
    let callCount = 0;

    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: "2.0", result: page }),
      });
    }));

    const result = await odooFetchAll(
      "https://odoo.test.com", "db", 1, "pass",
      "res.partner", [], ["id"], 1000,
    );

    // Should fetch 2 pages (0-499, 500-999) = 1000 records max
    expect(callCount).toBe(2);
    expect(result).toHaveLength(1000);
  });
});
