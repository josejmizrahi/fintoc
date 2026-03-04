/**
 * Odoo JSON-RPC Client
 * Shared by: onboarding route, reconciliation route
 */

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
