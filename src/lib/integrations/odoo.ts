import { ApiError } from '@/lib/utils/errors';

// ---------------------------------------------------------------------------
// Odoo JSON-RPC Client — Professional integration
// https://www.odoo.com/documentation/17.0/developer/reference/external_api.html
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT = 20_000;
const MAX_RETRIES = 3;
const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface OdooConfig {
  url: string;
  db: string;
  uid: number;
  apiKey: string;
}

export interface OdooPartner {
  id: number;
  name: string;
  vat: string | false;
  email: string | false;
  phone: string | false;
  bank_ids: number[];
  street?: string | false;
  city?: string | false;
  state_id?: [number, string] | false;
  country_id?: [number, string] | false;
  supplier_rank?: number;
  customer_rank?: number;
  active: boolean;
  write_date: string;
}

export interface OdooInvoice {
  id: number;
  name: string;
  move_type: 'in_invoice' | 'out_invoice' | 'in_refund' | 'out_refund' | 'entry';
  partner_id: [number, string] | false;
  invoice_date: string | false;
  invoice_date_due: string | false;
  amount_total: number;
  amount_residual: number;
  amount_tax: number;
  amount_untaxed: number;
  currency_id: [number, string];
  state: 'draft' | 'posted' | 'cancel';
  payment_state: 'not_paid' | 'in_payment' | 'paid' | 'partial' | 'reversed';
  l10n_mx_edi_cfdi_uuid: string | false;
  l10n_mx_edi_payment_policy: string | false;
  l10n_mx_edi_usage: string | false;
  ref: string | false;
  narration: string | false;
  write_date: string;
}

export interface OdooPaymentValues {
  payment_type: 'outbound' | 'inbound';
  partner_type: 'supplier' | 'customer';
  partner_id: number;
  amount: number;
  currency_id: number;
  journal_id: number;
  ref: string;
  payment_method_line_id?: number;
}

export interface OdooPaginationParams {
  batchSize?: number;
  offset?: number;
  order?: string;
}

interface JsonRpcResponse {
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: {
      name: string;
      debug: string;
      message: string;
      arguments: string[];
      exception_type?: string;
    };
  };
}

// ---------------------------------------------------------------------------
// Core JSON-RPC client
// ---------------------------------------------------------------------------
async function odooRpc(
  config: OdooConfig,
  service: 'object' | 'common',
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown> = {},
  retries = MAX_RETRIES,
  timeout = DEFAULT_TIMEOUT
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const rpcArgs = service === 'object'
      ? [config.db, config.uid, config.apiKey, method, ...args]
      : [config.db, ...args];

    const res = await fetch(`${config.url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        id: Date.now(),
        params: {
          service,
          method: service === 'object' ? 'execute_kw' : method,
          args: rpcArgs,
          kwargs: service === 'object' ? kwargs : undefined,
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      if (retries > 0 && res.status >= 500) {
        const backoff = Math.pow(2, MAX_RETRIES - retries) * 2000;
        await new Promise(resolve => setTimeout(resolve, backoff));
        return odooRpc(config, service, method, args, kwargs, retries - 1, timeout);
      }
      throw new ApiError('ODOO_ERROR', `Odoo HTTP ${res.status}`, 502);
    }

    const data = await res.json() as JsonRpcResponse;

    if (data.error) {
      const errData = data.error.data;
      const errorName = errData?.name || 'Unknown';
      const errorMsg = errData?.message || data.error.message;
      const isAccessError = errorName.includes('AccessError') || errorName.includes('AccessDenied');
      const isValidationError = errorName.includes('ValidationError') || errorName.includes('UserError');

      // Don't retry client errors
      if (isAccessError || isValidationError) {
        throw new ApiError('ODOO_ERROR', `Odoo ${errorName}: ${errorMsg}`, isAccessError ? 403 : 422, {
          odooError: errorName,
          debug: errData?.debug?.substring(0, 500),
        });
      }

      // Retry server errors
      if (retries > 0) {
        const backoff = Math.pow(2, MAX_RETRIES - retries) * 2000;
        await new Promise(resolve => setTimeout(resolve, backoff));
        return odooRpc(config, service, method, args, kwargs, retries - 1, timeout);
      }

      throw new ApiError('ODOO_ERROR', `Odoo: ${errorMsg}`, 502, {
        odooError: errorName,
        debug: errData?.debug?.substring(0, 500),
      });
    }

    return data.result;
  } catch (err) {
    if (err instanceof ApiError) throw err;

    if ((err as Error).name === 'AbortError') {
      if (retries > 0) {
        const backoff = Math.pow(2, MAX_RETRIES - retries) * 2000;
        await new Promise(resolve => setTimeout(resolve, backoff));
        return odooRpc(config, service, method, args, kwargs, retries - 1, timeout);
      }
      throw new ApiError('INTEGRATION_TIMEOUT', 'Timeout al comunicarse con Odoo', 504);
    }

    if (retries > 0) {
      const backoff = Math.pow(2, MAX_RETRIES - retries) * 2000;
      await new Promise(resolve => setTimeout(resolve, backoff));
      return odooRpc(config, service, method, args, kwargs, retries - 1, timeout);
    }

    throw new ApiError('ODOO_ERROR', `Error de red al comunicarse con Odoo: ${(err as Error).message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------
export async function odooAuthenticate(
  url: string,
  db: string,
  username: string,
  password: string
): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

  try {
    const res = await fetch(`${url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        id: 1,
        params: {
          service: 'common',
          method: 'authenticate',
          args: [db, username, password, {}],
        },
      }),
      signal: controller.signal,
    });

    const data = await res.json() as JsonRpcResponse;
    if (data.error || !data.result) {
      throw new ApiError('ODOO_ERROR', 'Error de autenticación con Odoo: credenciales inválidas', 401);
    }
    return data.result as number;
  } finally {
    clearTimeout(timer);
  }
}

export async function odooCheckConnection(config: OdooConfig): Promise<boolean> {
  try {
    const result = await odooRpc(config, 'object', 'res.users', ['search_count', [[['id', '=', config.uid]]]]);
    return (result as number) > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// CRUD Operations
// ---------------------------------------------------------------------------
export async function odooSearchRead(
  config: OdooConfig,
  model: string,
  domain: unknown[][],
  fields: string[],
  limit?: number,
  offset?: number,
  order?: string
): Promise<unknown[]> {
  const kwargs: Record<string, unknown> = { fields };
  if (limit !== undefined) kwargs.limit = limit;
  if (offset !== undefined) kwargs.offset = offset;
  if (order) kwargs.order = order;
  const result = await odooRpc(config, 'object', model, ['search_read', domain], kwargs);
  return result as unknown[];
}

export async function odooSearchCount(
  config: OdooConfig,
  model: string,
  domain: unknown[][]
): Promise<number> {
  const result = await odooRpc(config, 'object', model, ['search_count', domain]);
  return result as number;
}

export async function odooCreate(
  config: OdooConfig,
  model: string,
  values: Record<string, unknown>
): Promise<number> {
  const result = await odooRpc(config, 'object', model, ['create', [values]]);
  return result as number;
}

export async function odooWrite(
  config: OdooConfig,
  model: string,
  ids: number[],
  values: Record<string, unknown>
): Promise<boolean> {
  const result = await odooRpc(config, 'object', model, ['write', ids, values]);
  return result as boolean;
}

export async function odooCallMethod(
  config: OdooConfig,
  model: string,
  method: string,
  ids: number[]
): Promise<unknown> {
  return odooRpc(config, 'object', model, [method, ids]);
}

// ---------------------------------------------------------------------------
// Automatic pagination — fetches all records in batches
// ---------------------------------------------------------------------------
export async function odooFetchAll(
  config: OdooConfig,
  model: string,
  domain: unknown[][],
  fields: string[],
  options?: OdooPaginationParams
): Promise<unknown[]> {
  const batchSize = Math.min(options?.batchSize || DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE);
  const order = options?.order || 'write_date desc, id desc';
  const allRecords: unknown[] = [];
  let offset = options?.offset || 0;

  const totalCount = await odooSearchCount(config, model, domain);
  if (totalCount === 0) return [];

  while (offset < totalCount) {
    const batch = await odooSearchRead(config, model, domain, fields, batchSize, offset, order);
    if (!batch || batch.length === 0) break;
    allRecords.push(...batch);
    offset += batch.length;
    if (batch.length < batchSize) break;
  }

  return allRecords;
}

export async function odooFetchIncremental(
  config: OdooConfig,
  model: string,
  baseDomain: unknown[][],
  fields: string[],
  lastSyncAt?: string,
  options?: OdooPaginationParams
): Promise<unknown[]> {
  const domain = [...baseDomain];
  if (lastSyncAt) {
    domain.push(['write_date', '>', lastSyncAt]);
  }
  const fieldsWithDate = fields.includes('write_date') ? fields : [...fields, 'write_date'];
  return odooFetchAll(config, model, domain, fieldsWithDate, {
    ...options,
    order: 'write_date desc, id desc',
  });
}

// ---------------------------------------------------------------------------
// Vendor sync
// ---------------------------------------------------------------------------
const VENDOR_FIELDS = [
  'name', 'vat', 'email', 'phone', 'bank_ids',
  'street', 'city', 'state_id', 'country_id',
  'active', 'write_date',
];

export async function fetchOdooVendors(
  config: OdooConfig,
  lastSyncAt?: string
): Promise<OdooPartner[]> {
  return odooFetchIncremental(
    config,
    'res.partner',
    [['supplier_rank', '>', 0], ['is_company', '=', true]],
    VENDOR_FIELDS,
    lastSyncAt
  ) as Promise<OdooPartner[]>;
}

// ---------------------------------------------------------------------------
// Customer sync
// ---------------------------------------------------------------------------
const CUSTOMER_FIELDS = [
  'name', 'vat', 'email', 'phone',
  'street', 'city', 'state_id', 'country_id',
  'active', 'write_date',
];

export async function fetchOdooCustomers(
  config: OdooConfig,
  lastSyncAt?: string
): Promise<OdooPartner[]> {
  return odooFetchIncremental(
    config,
    'res.partner',
    [['customer_rank', '>', 0], ['is_company', '=', true]],
    CUSTOMER_FIELDS,
    lastSyncAt
  ) as Promise<OdooPartner[]>;
}

// ---------------------------------------------------------------------------
// Invoice sync — includes credit notes
// ---------------------------------------------------------------------------
const INVOICE_FIELDS = [
  'name', 'move_type', 'partner_id', 'invoice_date', 'invoice_date_due',
  'amount_total', 'amount_residual', 'amount_tax', 'amount_untaxed',
  'currency_id', 'state', 'payment_state',
  'l10n_mx_edi_cfdi_uuid', 'l10n_mx_edi_payment_policy', 'l10n_mx_edi_usage',
  'ref', 'narration', 'write_date',
];

export async function fetchOdooInvoices(
  config: OdooConfig,
  lastSyncAt?: string
): Promise<OdooInvoice[]> {
  return odooFetchIncremental(
    config,
    'account.move',
    [
      ['move_type', 'in', ['in_invoice', 'out_invoice', 'in_refund', 'out_refund']],
      ['state', '=', 'posted'],
    ],
    INVOICE_FIELDS,
    lastSyncAt
  ) as Promise<OdooInvoice[]>;
}

// ---------------------------------------------------------------------------
// Payment creation with writeback
// ---------------------------------------------------------------------------
export async function createOdooPayment(
  config: OdooConfig,
  values: OdooPaymentValues
): Promise<number> {
  const paymentId = await odooCreate(config, 'account.payment', values as unknown as Record<string, unknown>);
  await odooCallMethod(config, 'account.payment', 'action_post', [paymentId]);
  return paymentId;
}

export async function createAndReconcilePayment(
  config: OdooConfig,
  invoiceMoveId: number,
  values: OdooPaymentValues
): Promise<{ paymentId: number; reconciled: boolean }> {
  const paymentId = await createOdooPayment(config, values);

  let reconciled = false;
  try {
    await odooCallMethod(config, 'account.move', 'js_assign_outstanding_line', [invoiceMoveId]);
    reconciled = true;
  } catch {
    // Reconciliation is best-effort
  }

  return { paymentId, reconciled };
}

// ---------------------------------------------------------------------------
// Partner bank accounts
// ---------------------------------------------------------------------------
export async function fetchPartnerBankAccounts(
  config: OdooConfig,
  partnerId: number
): Promise<Array<{ id: number; acc_number: string; bank_id: [number, string] | false }>> {
  return odooSearchRead(
    config,
    'res.partner.bank',
    [['partner_id', '=', partnerId]],
    ['acc_number', 'bank_id']
  ) as Promise<Array<{ id: number; acc_number: string; bank_id: [number, string] | false }>>;
}

// ---------------------------------------------------------------------------
// Journal lookup
// ---------------------------------------------------------------------------
export async function fetchJournals(
  config: OdooConfig,
  type?: 'bank' | 'cash' | 'sale' | 'purchase'
): Promise<Array<{ id: number; name: string; type: string; currency_id: [number, string] | false }>> {
  const domain: unknown[][] = [];
  if (type) domain.push(['type', '=', type]);
  return odooSearchRead(
    config,
    'account.journal',
    domain,
    ['name', 'type', 'currency_id']
  ) as Promise<Array<{ id: number; name: string; type: string; currency_id: [number, string] | false }>>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function normalizeOdooValue<T>(value: T | false): T | null {
  return value === false ? null : value;
}

export function extractM2oName(field: [number, string] | false): string | null {
  if (field === false || !field) return null;
  return field[1];
}

export function extractM2oId(field: [number, string] | false): number | null {
  if (field === false || !field) return null;
  return field[0];
}
