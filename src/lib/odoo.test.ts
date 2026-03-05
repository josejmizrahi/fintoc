import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  odooJsonRpc,
  odooAuthenticate,
  odooSearchRead,
  odooSearch,
  odooRead,
  odooCreate,
  odooWrite,
  odooUnlink,
  odooSearchCount,
  odooFieldsGet,
  odooNameGet,
  odooExecute,
  odooFetchAll,
  OdooClient,
  createOdooClient,
  m2oId,
  m2oName,
} from "./odoo";

// ── Mock fetch ──

function mockFetch(result: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve({ jsonrpc: "2.0", result }),
  });
}

function mockFetchError(error: { message: string; data?: { message?: string } }) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ jsonrpc: "2.0", error }),
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ── odooJsonRpc ──

describe("odooJsonRpc", () => {
  it("sends correct JSON-RPC payload", async () => {
    const mock = mockFetch(42);
    vi.stubGlobal("fetch", mock);

    const result = await odooJsonRpc("https://odoo.test", "common", "authenticate", ["db", "user", "pass", {}]);

    expect(result.result).toBe(42);
    expect(mock).toHaveBeenCalledOnce();
    const call = mock.mock.calls[0];
    expect(call[0]).toBe("https://odoo.test/jsonrpc");
    const body = JSON.parse(call[1].body);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.params.service).toBe("common");
    expect(body.params.method).toBe("authenticate");
  });

  it("strips trailing slash from URL", async () => {
    const mock = mockFetch(true);
    vi.stubGlobal("fetch", mock);

    await odooJsonRpc("https://odoo.test/", "object", "execute_kw", []);
    expect(mock.mock.calls[0][0]).toBe("https://odoo.test/jsonrpc");
  });

  it("throws on HTTP error after retries", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    // withRetry uses exponential backoff, so use a long timeout
    await expect(odooJsonRpc("https://odoo.test", "common", "version", [], 100)).rejects.toThrow("HTTP 500");
  }, 30000);
});

// ── odooAuthenticate ──

describe("odooAuthenticate", () => {
  it("returns uid on successful auth", async () => {
    vi.stubGlobal("fetch", mockFetch(7));
    const uid = await odooAuthenticate("https://odoo.test", "mydb", "admin", "secret");
    expect(uid).toBe(7);
  });

  it("throws on invalid credentials (false result)", async () => {
    vi.stubGlobal("fetch", mockFetch(false));
    await expect(odooAuthenticate("https://odoo.test", "mydb", "admin", "wrong")).rejects.toThrow("Credenciales invalidas");
  });

  it("throws on error response", async () => {
    vi.stubGlobal("fetch", mockFetchError({ message: "Access denied", data: { message: "Invalid API key" } }));
    await expect(odooAuthenticate("https://odoo.test", "mydb", "admin", "bad")).rejects.toThrow("Invalid API key");
  });
});

// ── odooSearchRead ──

describe("odooSearchRead", () => {
  it("returns records array", async () => {
    const records = [{ id: 1, name: "Test" }, { id: 2, name: "Test2" }];
    vi.stubGlobal("fetch", mockFetch(records));

    const result = await odooSearchRead("https://odoo.test", "db", 1, "pass", "res.partner", [["name", "=", "Test"]], ["id", "name"]);
    expect(result).toEqual(records);
  });

  it("returns empty array when result is null", async () => {
    vi.stubGlobal("fetch", mockFetch(null));
    const result = await odooSearchRead("https://odoo.test", "db", 1, "pass", "res.partner", [], ["id"]);
    expect(result).toEqual([]);
  });

  it("passes limit and offset", async () => {
    const mock = mockFetch([]);
    vi.stubGlobal("fetch", mock);

    await odooSearchRead("https://odoo.test", "db", 1, "pass", "account.move", [], ["id"], 100, 50);
    const body = JSON.parse(mock.mock.calls[0][1].body);
    const kwargs = body.params.args[6];
    expect(kwargs.limit).toBe(100);
    expect(kwargs.offset).toBe(50);
  });
});

// ── odooSearch ──

describe("odooSearch", () => {
  it("returns array of IDs", async () => {
    vi.stubGlobal("fetch", mockFetch([1, 2, 3]));
    const result = await odooSearch("https://odoo.test", "db", 1, "pass", "res.partner", [], 10);
    expect(result).toEqual([1, 2, 3]);
  });
});

// ── odooRead ──

describe("odooRead", () => {
  it("returns records by IDs", async () => {
    const records = [{ id: 5, name: "Record 5" }];
    vi.stubGlobal("fetch", mockFetch(records));
    const result = await odooRead("https://odoo.test", "db", 1, "pass", "res.partner", [5], ["id", "name"]);
    expect(result).toEqual(records);
  });
});

// ── odooCreate ──

describe("odooCreate", () => {
  it("returns new record ID", async () => {
    vi.stubGlobal("fetch", mockFetch(42));
    const id = await odooCreate("https://odoo.test", "db", 1, "pass", "account.payment", { amount: 1000 });
    expect(id).toBe(42);
  });
});

// ── odooWrite ──

describe("odooWrite", () => {
  it("returns true on success", async () => {
    vi.stubGlobal("fetch", mockFetch(true));
    const result = await odooWrite("https://odoo.test", "db", 1, "pass", "res.partner", [1], { name: "Updated" });
    expect(result).toBe(true);
  });

  it("sends correct args with IDs and data", async () => {
    const mock = mockFetch(true);
    vi.stubGlobal("fetch", mock);

    await odooWrite("https://odoo.test", "db", 1, "pass", "res.partner", [5, 10], { email: "new@test.com" });
    const body = JSON.parse(mock.mock.calls[0][1].body);
    const args = body.params.args;
    expect(args[4]).toBe("write");
    expect(args[5]).toEqual([[5, 10], { email: "new@test.com" }]);
  });
});

// ── odooUnlink ──

describe("odooUnlink", () => {
  it("returns true on success", async () => {
    vi.stubGlobal("fetch", mockFetch(true));
    const result = await odooUnlink("https://odoo.test", "db", 1, "pass", "res.partner", [99]);
    expect(result).toBe(true);
  });
});

// ── odooSearchCount ──

describe("odooSearchCount", () => {
  it("returns count number", async () => {
    vi.stubGlobal("fetch", mockFetch(150));
    const count = await odooSearchCount("https://odoo.test", "db", 1, "pass", "account.move", [["state", "=", "posted"]]);
    expect(count).toBe(150);
  });

  it("returns 0 for null result", async () => {
    vi.stubGlobal("fetch", mockFetch(null));
    const count = await odooSearchCount("https://odoo.test", "db", 1, "pass", "account.move", []);
    expect(count).toBe(0);
  });
});

// ── odooFieldsGet ──

describe("odooFieldsGet", () => {
  it("returns field definitions", async () => {
    const fields = { name: { type: "char", string: "Name" }, amount: { type: "float", string: "Amount" } };
    vi.stubGlobal("fetch", mockFetch(fields));
    const result = await odooFieldsGet("https://odoo.test", "db", 1, "pass", "account.move");
    expect(result.name.type).toBe("char");
    expect(result.amount.type).toBe("float");
  });
});

// ── odooNameGet ──

describe("odooNameGet", () => {
  it("returns ID-name pairs", async () => {
    const pairs: [number, string][] = [[1, "Partner A"], [2, "Partner B"]];
    vi.stubGlobal("fetch", mockFetch(pairs));
    const result = await odooNameGet("https://odoo.test", "db", 1, "pass", "res.partner", [1, 2]);
    expect(result).toEqual(pairs);
  });
});

// ── odooExecute ──

describe("odooExecute", () => {
  it("calls action method on records", async () => {
    vi.stubGlobal("fetch", mockFetch(true));
    const result = await odooExecute("https://odoo.test", "db", 1, "pass", "account.payment", "action_post", [42]);
    expect(result).toBe(true);
  });
});

// ── odooFetchAll ──

describe("odooFetchAll", () => {
  it("paginates through all records", async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => ({ id: i + 1 }));
    const page2 = Array.from({ length: 100 }, (_, i) => ({ id: i + 501 }));

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      callCount++;
      const records = callCount === 1 ? page1 : page2;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: "2.0", result: records }),
      });
    }));

    const result = await odooFetchAll("https://odoo.test", "db", 1, "pass", "res.partner", [], ["id"]);
    expect(result).toHaveLength(600);
    expect(result[0].id).toBe(1);
    expect(result[599].id).toBe(600);
  });

  it("stops when fewer records than page size", async () => {
    vi.stubGlobal("fetch", mockFetch([{ id: 1 }, { id: 2 }]));
    const result = await odooFetchAll("https://odoo.test", "db", 1, "pass", "res.partner", [], ["id"]);
    expect(result).toHaveLength(2);
  });
});

// ── OdooClient class ──

describe("OdooClient", () => {
  it("connects and stores uid", async () => {
    vi.stubGlobal("fetch", mockFetch(7));
    const client = new OdooClient({ url: "https://odoo.test", database: "db", user: "admin", password: "pass" });
    expect(client.connected).toBe(false);
    const uid = await client.connect();
    expect(uid).toBe(7);
    expect(client.connected).toBe(true);
  });

  it("throws when calling methods before connect", async () => {
    const client = new OdooClient({ url: "https://odoo.test", database: "db", user: "admin", password: "pass" });
    await expect(client.searchRead("res.partner", [], ["id"])).rejects.toThrow("no conectado");
  });

  it("searchRead delegates correctly", async () => {
    const records = [{ id: 1, name: "Test" }];
    let callIdx = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      callIdx++;
      const result = callIdx === 1 ? 7 : records;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: "2.0", result }),
      });
    }));

    const client = new OdooClient({ url: "https://odoo.test", database: "db", user: "admin", password: "pass" });
    await client.connect();
    const result = await client.searchRead("res.partner", [["id", "=", 1]], ["id", "name"]);
    expect(result).toEqual(records);
  });

  it("create returns new ID", async () => {
    let callIdx = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      callIdx++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: "2.0", result: callIdx === 1 ? 7 : 99 }),
      });
    }));

    const client = new OdooClient({ url: "https://odoo.test", database: "db", user: "admin", password: "pass" });
    await client.connect();
    const id = await client.create("account.payment", { amount: 5000 });
    expect(id).toBe(99);
  });

  it("write delegates correctly", async () => {
    let callIdx = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      callIdx++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: "2.0", result: callIdx === 1 ? 7 : true }),
      });
    }));

    const client = new OdooClient({ url: "https://odoo.test", database: "db", user: "admin", password: "pass" });
    await client.connect();
    const result = await client.write("res.partner", [1], { name: "Updated" });
    expect(result).toBe(true);
  });

  it("callAction delegates correctly", async () => {
    let callIdx = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      callIdx++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: "2.0", result: callIdx === 1 ? 7 : true }),
      });
    }));

    const client = new OdooClient({ url: "https://odoo.test", database: "db", user: "admin", password: "pass" });
    await client.connect();
    const result = await client.callAction("account.payment", "action_post", [42]);
    expect(result).toBe(true);
  });

  it("findBankJournalId uses correct domain", async () => {
    let callIdx = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      callIdx++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: "2.0", result: callIdx === 1 ? 7 : [15] }),
      });
    }));

    const client = new OdooClient({ url: "https://odoo.test", database: "db", user: "admin", password: "pass" });
    await client.connect();
    const id = await client.findBankJournalId();
    expect(id).toBe(15);
  });

  it("findPartnerByRfc searches by vat", async () => {
    let callIdx = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      callIdx++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: "2.0", result: callIdx === 1 ? 7 : [33] }),
      });
    }));

    const client = new OdooClient({ url: "https://odoo.test", database: "db", user: "admin", password: "pass" });
    await client.connect();
    const id = await client.findPartnerByRfc("ABC010101AAA");
    expect(id).toBe(33);
  });
});

// ── createOdooClient ──

describe("createOdooClient", () => {
  it("creates client from config", () => {
    const client = createOdooClient({ url: "https://odoo.test", database: "db", user: "admin", password: "pass" });
    expect(client).toBeInstanceOf(OdooClient);
  });

  it("throws on incomplete config", () => {
    expect(() => createOdooClient({ url: "https://odoo.test", database: "", user: "", password: "" }))
      .toThrow("incompleta");
  });
});

// ── Many2one helpers ──

describe("m2oId", () => {
  it("extracts ID from array", () => {
    expect(m2oId([42, "Partner Name"])).toBe(42);
  });

  it("returns number directly", () => {
    expect(m2oId(42)).toBe(42);
  });

  it("returns null for false/null", () => {
    expect(m2oId(false)).toBeNull();
    expect(m2oId(null)).toBeNull();
    expect(m2oId(undefined)).toBeNull();
  });
});

describe("m2oName", () => {
  it("extracts name from array", () => {
    expect(m2oName([42, "Partner Name"])).toBe("Partner Name");
  });

  it("returns string directly", () => {
    expect(m2oName("Direct Name")).toBe("Direct Name");
  });

  it("returns empty string for false/null", () => {
    expect(m2oName(false)).toBe("");
    expect(m2oName(null)).toBe("");
    expect(m2oName(undefined)).toBe("");
  });
});
