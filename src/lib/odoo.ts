/**
 * Odoo Client — Complete JSON-RPC abstraction layer
 *
 * Supports all ORM methods: search_read, search, read, create, write, unlink,
 * search_count, fields_get, name_get, and action method execution.
 *
 * Designed as an abstraction layer for easy migration from JSON-RPC to
 * Odoo 19+ JSON-2 REST API. All external code uses OdooClient class methods;
 * switching the transport layer only requires changing this file.
 *
 * JSON-RPC will be removed in Odoo 20 (fall 2026). This abstraction
 * encapsulates the protocol so the rest of the codebase is unaffected.
 */

import { withRetry } from "./retry";

// ── Types ──

export interface OdooJsonRpcResult {
  jsonrpc: string;
  result?: unknown;
  error?: { message: string; data?: { message?: string; debug?: string } };
}

export interface OdooConnectionConfig {
  url: string;
  database: string;
  user: string;
  password: string;
}

export interface OdooFieldDef {
  type: string;
  string: string;
  help?: string;
  required?: boolean;
  readonly?: boolean;
  relation?: string;
  selection?: [string, string][];
}

export type OdooDomain = Array<string | number | boolean | string[] | number[] | [string, string, unknown]>;

// ── Low-level JSON-RPC transport ──

export async function odooJsonRpc(
  url: string,
  service: string,
  method: string,
  args: unknown[],
  timeout = 15000,
): Promise<OdooJsonRpcResult> {
  return withRetry(async () => {
    const res = await fetch(`${url.replace(/\/$/, "")}/jsonrpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        id: Date.now(),
        params: { service, method, args },
      }),
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, { retryOn: (err) => !(err instanceof Error && err.message.includes("Credenciales")) });
}

// ── Authentication ──

export async function odooAuthenticate(
  url: string,
  db: string,
  login: string,
  password: string,
): Promise<number> {
  const result = await odooJsonRpc(url, "common", "authenticate", [db, login, password, {}]);
  if (result.error) throw new Error(result.error.data?.message || result.error.message);
  const uid = result.result as number | false;
  if (!uid) throw new Error("Credenciales invalidas");
  return uid;
}

// ── ORM Method Wrappers ──

/** Search + read records (most common operation) */
export async function odooSearchRead(
  url: string, db: string, uid: number, password: string,
  model: string, domain: unknown[][], fields: string[],
  limit = 500, offset = 0, order?: string,
): Promise<Record<string, unknown>[]> {
  const kwargs: Record<string, unknown> = { fields, limit, offset };
  if (order) kwargs.order = order;
  const result = await odooJsonRpc(
    url, "object", "execute_kw",
    [db, uid, password, model, "search_read", [domain], kwargs],
    30000,
  );
  if (result.error) throw new Error(result.error.data?.message || result.error.message);
  return (result.result as Record<string, unknown>[]) || [];
}

/** Search for record IDs only */
export async function odooSearch(
  url: string, db: string, uid: number, password: string,
  model: string, domain: unknown[][], limit = 10, order?: string,
): Promise<number[]> {
  const kwargs: Record<string, unknown> = { limit };
  if (order) kwargs.order = order;
  const result = await odooJsonRpc(
    url, "object", "execute_kw",
    [db, uid, password, model, "search", [domain], kwargs],
    15000,
  );
  if (result.error) throw new Error(result.error.data?.message || result.error.message);
  return (result.result as number[]) || [];
}

/** Read specific records by IDs */
export async function odooRead(
  url: string, db: string, uid: number, password: string,
  model: string, ids: number[], fields: string[],
): Promise<Record<string, unknown>[]> {
  const result = await odooJsonRpc(
    url, "object", "execute_kw",
    [db, uid, password, model, "read", [ids], { fields }],
    30000,
  );
  if (result.error) throw new Error(result.error.data?.message || result.error.message);
  return (result.result as Record<string, unknown>[]) || [];
}

/** Create a record, returns new ID */
export async function odooCreate(
  url: string, db: string, uid: number, password: string,
  model: string, data: Record<string, unknown>,
): Promise<number> {
  const result = await odooJsonRpc(
    url, "object", "execute_kw",
    [db, uid, password, model, "create", [data]],
    30000,
  );
  if (result.error) throw new Error(result.error.data?.message || result.error.message);
  return result.result as number;
}

/** Update existing records */
export async function odooWrite(
  url: string, db: string, uid: number, password: string,
  model: string, ids: number[], data: Record<string, unknown>,
): Promise<boolean> {
  const result = await odooJsonRpc(
    url, "object", "execute_kw",
    [db, uid, password, model, "write", [ids, data]],
    30000,
  );
  if (result.error) throw new Error(result.error.data?.message || result.error.message);
  return result.result as boolean;
}

/** Delete records */
export async function odooUnlink(
  url: string, db: string, uid: number, password: string,
  model: string, ids: number[],
): Promise<boolean> {
  const result = await odooJsonRpc(
    url, "object", "execute_kw",
    [db, uid, password, model, "unlink", [ids]],
    30000,
  );
  if (result.error) throw new Error(result.error.data?.message || result.error.message);
  return result.result as boolean;
}

/** Count records matching domain */
export async function odooSearchCount(
  url: string, db: string, uid: number, password: string,
  model: string, domain: unknown[][],
): Promise<number> {
  const result = await odooJsonRpc(
    url, "object", "execute_kw",
    [db, uid, password, model, "search_count", [domain]],
    15000,
  );
  if (result.error) throw new Error(result.error.data?.message || result.error.message);
  return (result.result as number) || 0;
}

/** Get field definitions for a model */
export async function odooFieldsGet(
  url: string, db: string, uid: number, password: string,
  model: string, attributes?: string[],
): Promise<Record<string, OdooFieldDef>> {
  const kwargs: Record<string, unknown> = {};
  if (attributes) kwargs.attributes = attributes;
  const result = await odooJsonRpc(
    url, "object", "execute_kw",
    [db, uid, password, model, "fields_get", [], kwargs],
    15000,
  );
  if (result.error) throw new Error(result.error.data?.message || result.error.message);
  return (result.result as Record<string, OdooFieldDef>) || {};
}

/** Get display names for record IDs */
export async function odooNameGet(
  url: string, db: string, uid: number, password: string,
  model: string, ids: number[],
): Promise<[number, string][]> {
  const result = await odooJsonRpc(
    url, "object", "execute_kw",
    [db, uid, password, model, "name_get", [ids]],
    15000,
  );
  if (result.error) throw new Error(result.error.data?.message || result.error.message);
  return (result.result as [number, string][]) || [];
}

/** Execute an action method on records (e.g., action_post, action_cancel) */
export async function odooExecute(
  url: string, db: string, uid: number, password: string,
  model: string, method: string, ids: number[],
  kwargs?: Record<string, unknown>,
): Promise<unknown> {
  const args: unknown[] = [db, uid, password, model, method, [ids]];
  if (kwargs) args.push(kwargs);
  const result = await odooJsonRpc(url, "object", "execute_kw", args, 30000);
  if (result.error) throw new Error(result.error.data?.message || result.error.message);
  return result.result;
}

/** Paginated fetch — retrieves all records in chunks */
export async function odooFetchAll(
  url: string, db: string, uid: number, password: string,
  model: string, domain: unknown[][], fields: string[],
  maxRecords = 10000, order?: string,
): Promise<Record<string, unknown>[]> {
  const PAGE = 500;
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  while (offset < maxRecords) {
    const page = await odooSearchRead(url, db, uid, password, model, domain, fields, PAGE, offset, order);
    all.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// ── OdooClient Class — High-level abstraction for JSON-2 migration ──

/**
 * OdooClient wraps all Odoo operations behind a clean interface.
 * Today it uses JSON-RPC; when migrating to Odoo 19+ JSON-2 API,
 * only the internals of this class need to change.
 *
 * Usage:
 *   const client = new OdooClient({ url, database, user, password });
 *   await client.connect();
 *   const invoices = await client.searchRead('account.move', [...], [...]);
 *   const paymentId = await client.create('account.payment', { ... });
 *   await client.callAction('account.payment', 'action_post', [paymentId]);
 */
export class OdooClient {
  private config: OdooConnectionConfig;
  private uid: number = 0;
  private _connected = false;

  constructor(config: OdooConnectionConfig) {
    this.config = config;
  }

  get connected() { return this._connected; }

  /** Authenticate and store uid */
  async connect(): Promise<number> {
    this.uid = await odooAuthenticate(
      this.config.url, this.config.database,
      this.config.user, this.config.password,
    );
    this._connected = true;
    return this.uid;
  }

  private ensureConnected() {
    if (!this._connected) throw new Error("OdooClient: no conectado. Llamar connect() primero.");
  }

  private get url() { return this.config.url; }
  private get db() { return this.config.database; }
  private get pw() { return this.config.password; }

  /** Search + read records */
  async searchRead(
    model: string, domain: unknown[][], fields: string[],
    limit = 500, offset = 0, order?: string,
  ): Promise<Record<string, unknown>[]> {
    this.ensureConnected();
    return odooSearchRead(this.url, this.db, this.uid, this.pw, model, domain, fields, limit, offset, order);
  }

  /** Search for IDs */
  async search(model: string, domain: unknown[][], limit = 10, order?: string): Promise<number[]> {
    this.ensureConnected();
    return odooSearch(this.url, this.db, this.uid, this.pw, model, domain, limit, order);
  }

  /** Read records by IDs */
  async read(model: string, ids: number[], fields: string[]): Promise<Record<string, unknown>[]> {
    this.ensureConnected();
    return odooRead(this.url, this.db, this.uid, this.pw, model, ids, fields);
  }

  /** Create a record */
  async create(model: string, data: Record<string, unknown>): Promise<number> {
    this.ensureConnected();
    return odooCreate(this.url, this.db, this.uid, this.pw, model, data);
  }

  /** Update records */
  async write(model: string, ids: number[], data: Record<string, unknown>): Promise<boolean> {
    this.ensureConnected();
    return odooWrite(this.url, this.db, this.uid, this.pw, model, ids, data);
  }

  /** Delete records */
  async unlink(model: string, ids: number[]): Promise<boolean> {
    this.ensureConnected();
    return odooUnlink(this.url, this.db, this.uid, this.pw, model, ids);
  }

  /** Count records */
  async searchCount(model: string, domain: unknown[][]): Promise<number> {
    this.ensureConnected();
    return odooSearchCount(this.url, this.db, this.uid, this.pw, model, domain);
  }

  /** Get field definitions */
  async fieldsGet(model: string, attributes?: string[]): Promise<Record<string, OdooFieldDef>> {
    this.ensureConnected();
    return odooFieldsGet(this.url, this.db, this.uid, this.pw, model, attributes);
  }

  /** Get display names */
  async nameGet(model: string, ids: number[]): Promise<[number, string][]> {
    this.ensureConnected();
    return odooNameGet(this.url, this.db, this.uid, this.pw, model, ids);
  }

  /** Execute action method (e.g., action_post, button_confirm) */
  async callAction(model: string, method: string, ids: number[], kwargs?: Record<string, unknown>): Promise<unknown> {
    this.ensureConnected();
    return odooExecute(this.url, this.db, this.uid, this.pw, model, method, ids, kwargs);
  }

  /** Fetch all records with pagination */
  async fetchAll(model: string, domain: unknown[][], fields: string[], maxRecords = 10000, order?: string): Promise<Record<string, unknown>[]> {
    this.ensureConnected();
    return odooFetchAll(this.url, this.db, this.uid, this.pw, model, domain, fields, maxRecords, order);
  }

  // ── Convenience: Lookup cached IDs ──

  /** Find bank journal ID */
  async findBankJournalId(): Promise<number | null> {
    const ids = await this.search("account.journal", [["type", "=", "bank"]], 1);
    return ids[0] || null;
  }

  /** Find MXN currency ID */
  async findCurrencyId(name = "MXN"): Promise<number | null> {
    const ids = await this.search("res.currency", [["name", "=", name]], 1);
    return ids[0] || null;
  }

  /** Find payment method line for a journal */
  async findPaymentMethodLineId(journalId: number, paymentType = "outbound"): Promise<number | null> {
    const lines = await this.searchRead(
      "account.payment.method.line",
      [["journal_id", "=", journalId], ["payment_method_id.payment_type", "=", paymentType]],
      ["id", "name"],
      1,
    );
    return lines[0]?.id as number || null;
  }

  /** Find partner by RFC (vat) */
  async findPartnerByRfc(rfc: string): Promise<number | null> {
    const ids = await this.search("res.partner", [["vat", "=", rfc]], 1);
    return ids[0] || null;
  }

  /** Find partner by name (fuzzy) */
  async findPartnerByName(name: string): Promise<number | null> {
    const ids = await this.search("res.partner", [["name", "ilike", name]], 1);
    return ids[0] || null;
  }
}

// ── Helper: Create OdooClient from integration config ──

export function createOdooClient(config: Record<string, string>): OdooClient {
  const { url, database, user, password } = config;
  if (!url || !database || !user || !password) {
    throw new Error("Configuracion de Odoo incompleta");
  }
  return new OdooClient({ url, database, user, password });
}

// ── Odoo Many2one field helpers ──

/** Extract ID from a many2one field [id, name] */
export function m2oId(field: unknown): number | null {
  if (Array.isArray(field)) return (field[0] as number) || null;
  if (typeof field === "number") return field;
  return null;
}

/** Extract display name from a many2one field [id, name] */
export function m2oName(field: unknown): string {
  if (Array.isArray(field)) return (field[1] as string) || "";
  if (typeof field === "string") return field;
  return "";
}
