import { ApiError } from '@/lib/utils/errors';

const TIMEOUT = 15_000;
const MAX_RETRIES = 2;

export interface OdooConfig {
  url: string;
  db: string;
  uid: number;
  apiKey: string;
}

async function odooRpc(
  config: OdooConfig,
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown> = {},
  retries = MAX_RETRIES
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const res = await fetch(`${config.url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        id: Date.now(),
        params: {
          service: 'object',
          method: 'execute_kw',
          args: [config.db, config.uid, config.apiKey, model, method, ...args],
          kwargs,
        },
      }),
      signal: controller.signal,
    });

    const data = (await res.json()) as { result?: unknown; error?: { message: string } };
    if (data.error) {
      throw new ApiError('ODOO_ERROR', `Odoo: ${data.error.message}`, 502);
    }
    return data.result;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if ((err as Error).name === 'AbortError') {
      if (retries > 0) {
        const delay = Math.pow(2, MAX_RETRIES - retries) * 2000;
        await new Promise(resolve => setTimeout(resolve, delay));
        return odooRpc(config, model, method, args, kwargs, retries - 1);
      }
      throw new ApiError('INTEGRATION_TIMEOUT', 'Timeout al comunicarse con Odoo', 504);
    }
    throw new ApiError('ODOO_ERROR', 'Error al comunicarse con Odoo', 502);
  } finally {
    clearTimeout(timeout);
  }
}

export async function odooAuthenticate(
  url: string,
  db: string,
  username: string,
  password: string
): Promise<number> {
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
  });

  const data = (await res.json()) as { result?: number; error?: { message: string } };
  if (data.error || !data.result) {
    throw new ApiError('ODOO_ERROR', 'Error de autenticacion con Odoo', 502);
  }
  return data.result;
}

export async function odooSearchRead(
  config: OdooConfig,
  model: string,
  domain: unknown[][],
  fields: string[],
  limit?: number,
  offset?: number
): Promise<unknown[]> {
  const kwargs: Record<string, unknown> = { fields };
  if (limit !== undefined) kwargs.limit = limit;
  if (offset !== undefined) kwargs.offset = offset;
  const result = await odooRpc(config, model, 'search_read', [domain], kwargs);
  return result as unknown[];
}

export async function odooCreate(
  config: OdooConfig,
  model: string,
  values: Record<string, unknown>
): Promise<number> {
  const result = await odooRpc(config, model, 'create', [[values]]);
  return result as number;
}

export async function odooWrite(
  config: OdooConfig,
  model: string,
  ids: number[],
  values: Record<string, unknown>
): Promise<boolean> {
  const result = await odooRpc(config, model, 'write', [ids, values]);
  return result as boolean;
}

export async function odooCallMethod(
  config: OdooConfig,
  model: string,
  method: string,
  ids: number[]
): Promise<unknown> {
  return odooRpc(config, model, method, [ids]);
}

// Sync helpers
export async function fetchOdooVendors(config: OdooConfig, limit = 500): Promise<unknown[]> {
  return odooSearchRead(
    config,
    'res.partner',
    [['supplier_rank', '>', 0], ['is_company', '=', true]],
    ['name', 'vat', 'email', 'phone', 'bank_ids'],
    limit
  );
}

export async function fetchOdooCustomers(config: OdooConfig, limit = 500): Promise<unknown[]> {
  return odooSearchRead(
    config,
    'res.partner',
    [['customer_rank', '>', 0], ['is_company', '=', true]],
    ['name', 'vat', 'email', 'phone'],
    limit
  );
}

export async function fetchOdooInvoices(config: OdooConfig, limit = 500): Promise<unknown[]> {
  return odooSearchRead(
    config,
    'account.move',
    [['move_type', 'in', ['in_invoice', 'out_invoice']], ['state', '=', 'posted']],
    [
      'name', 'move_type', 'partner_id', 'invoice_date', 'invoice_date_due',
      'amount_total', 'amount_residual', 'currency_id', 'state',
      'l10n_mx_edi_cfdi_uuid', 'l10n_mx_edi_payment_policy',
    ],
    limit
  );
}

export async function createOdooPayment(
  config: OdooConfig,
  values: {
    payment_type: 'outbound' | 'inbound';
    partner_type: 'supplier' | 'customer';
    partner_id: number;
    amount: number;
    currency_id: number;
    journal_id: number;
    ref: string;
  }
): Promise<number> {
  const paymentId = await odooCreate(config, 'account.payment', values);
  // Post the payment
  await odooCallMethod(config, 'account.payment', 'action_post', [paymentId]);
  return paymentId;
}
