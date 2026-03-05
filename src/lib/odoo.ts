/**
 * Odoo JSON-RPC Client
 * Shared by: onboarding route, reconciliation route
 */

import { withRetry } from "./retry";

export interface OdooJsonRpcResult {
  jsonrpc: string;
  result?: unknown;
  error?: { message: string; data?: { message?: string } };
}

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

export async function odooAuthenticate(
  url: string,
  db: string,
  login: string,
  password: string,
): Promise<number> {
  const result = await odooJsonRpc(url, "common", "authenticate", [
    db,
    login,
    password,
    {},
  ]);
  if (result.error)
    throw new Error(result.error.data?.message || result.error.message);
  const uid = result.result as number | false;
  if (!uid) throw new Error("Credenciales invalidas");
  return uid;
}

export async function odooSearchRead(
  url: string,
  db: string,
  uid: number,
  password: string,
  model: string,
  domain: unknown[][],
  fields: string[],
  limit = 500,
  offset = 0,
): Promise<Record<string, unknown>[]> {
  const result = await odooJsonRpc(
    url,
    "object",
    "execute_kw",
    [db, uid, password, model, "search_read", [domain], { fields, limit, offset }],
    30000,
  );
  if (result.error)
    throw new Error(result.error.data?.message || result.error.message);
  return (result.result as Record<string, unknown>[]) || [];
}

/**
 * Create a record in Odoo.
 * Returns the new record ID.
 */
export async function odooCreate(
  url: string,
  db: string,
  uid: number,
  password: string,
  model: string,
  data: Record<string, unknown>,
): Promise<number> {
  const result = await odooJsonRpc(
    url, "object", "execute_kw",
    [db, uid, password, model, "create", [data]],
    30000,
  );
  if (result.error)
    throw new Error(result.error.data?.message || result.error.message);
  return result.result as number;
}

/**
 * Execute a method on Odoo records (e.g. action_post, action_cancel).
 * Returns the method result.
 */
export async function odooExecute(
  url: string,
  db: string,
  uid: number,
  password: string,
  model: string,
  method: string,
  ids: number[],
  kwargs?: Record<string, unknown>,
): Promise<unknown> {
  const args: unknown[] = [db, uid, password, model, method, [ids]];
  if (kwargs) args.push(kwargs);
  const result = await odooJsonRpc(url, "object", "execute_kw", args, 30000);
  if (result.error)
    throw new Error(result.error.data?.message || result.error.message);
  return result.result;
}

/**
 * Search for record IDs in Odoo.
 * Returns array of IDs.
 */
export async function odooSearch(
  url: string,
  db: string,
  uid: number,
  password: string,
  model: string,
  domain: unknown[][],
  limit = 10,
): Promise<number[]> {
  const result = await odooJsonRpc(
    url, "object", "execute_kw",
    [db, uid, password, model, "search", [domain], { limit }],
    15000,
  );
  if (result.error)
    throw new Error(result.error.data?.message || result.error.message);
  return (result.result as number[]) || [];
}

export async function odooFetchAll(
  url: string,
  db: string,
  uid: number,
  password: string,
  model: string,
  domain: unknown[][],
  fields: string[],
  maxRecords = 10000,
): Promise<Record<string, unknown>[]> {
  const PAGE = 500;
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  while (offset < maxRecords) {
    const page = await odooSearchRead(
      url, db, uid, password, model, domain, fields, PAGE, offset,
    );
    all.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}
