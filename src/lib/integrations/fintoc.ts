import crypto from 'crypto';
import * as jose from 'jose';
import { ApiError } from '@/lib/utils/errors';

// ---------------------------------------------------------------------------
// Fintoc API Client — Professional integration
// https://docs.fintoc.com/
// ---------------------------------------------------------------------------

const FINTOC_BASE = 'https://api.fintoc.com/v1';
const FINTOC_BASE_V2 = 'https://api.fintoc.com/v2';
const DEFAULT_TIMEOUT = 30_000;
const MAX_RETRIES = 3;
const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 300;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type TransferStatus = 'pending' | 'succeeded' | 'failed' | 'rejected' | 'returned' | 'return_pending';
export type MovementType = 'credit' | 'debit' | 'transfer' | 'check' | 'other';
export type PaymentIntentStatus = 'pending' | 'succeeded' | 'failed' | 'expired';

export interface FintocAccount {
  id: string;
  name: string;
  official_name?: string;
  number: string;
  holder_id?: string;
  holder_name?: string;
  type?: string;
  currency: string;
  balance: {
    available: number;
    current: number;
  };
  refreshed_at?: string;
}

export interface FintocMovement {
  id: string;
  amount: number;
  post_date: string;
  description: string;
  transaction_date?: string;
  currency?: string;
  reference_id?: string;
  type: MovementType;
  pending?: boolean;
  recipient_account?: {
    holder_id?: string;
    holder_name?: string;
    number?: string;
    institution?: { id: string; name: string };
  };
  sender_account?: {
    holder_id?: string;
    holder_name?: string;
    number?: string;
    institution?: { id: string; name: string };
  };
  comment?: string;
}

export interface FintocTransfer {
  id: string;
  amount: number;
  currency: string;
  status: TransferStatus;
  counterparty: {
    holder_id?: string;
    holder_name?: string;
    number: string;
    institution_id?: string;
    institution?: { id: string; name: string };
  };
  comment: string;
  account_id: string;
  reference_id?: string;
  created_at: string;
  executed_at?: string;
  error?: {
    type: string;
    message: string;
  };
}

export interface FintocPaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: PaymentIntentStatus;
  widget_token?: string;
  recipient_account: {
    holder_id?: string;
    holder_name?: string;
    number: string;
    institution_id?: string;
  };
  sender_account?: {
    holder_id?: string;
    holder_name?: string;
    number?: string;
    institution?: { id: string; name: string };
  };
  created_at: string;
  metadata?: Record<string, string>;
}

export interface FintocRequestMeta {
  statusCode: number;
  hasMore: boolean;
  nextLink?: string;
}

export interface FintocPaginationParams {
  per_page?: number;
  since?: string;
  until?: string;
  link_token?: string;
}

// ---------------------------------------------------------------------------
// Core HTTP client
// ---------------------------------------------------------------------------
function getSecretKey(override?: string): string {
  const key = override || process.env.FINTOC_SECRET_KEY;
  if (!key) {
    throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Fintoc secret key no configurada', 422);
  }
  return key;
}

async function fintocRequest<T = unknown>(
  method: string,
  path: string,
  options?: {
    body?: unknown;
    secretKey?: string;
    timeout?: number;
    retries?: number;
    idempotencyKey?: string;
    baseUrl?: string;
    extraHeaders?: Record<string, string>;
  }
): Promise<{ data: T; meta: FintocRequestMeta }> {
  const retries = options?.retries ?? MAX_RETRIES;
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const key = getSecretKey(options?.secretKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const base = options?.baseUrl ?? FINTOC_BASE;
    const url = path.startsWith('http') ? path : `${base}${path}`;
    const headers: Record<string, string> = {
      'Authorization': key,
      'Content-Type': 'application/json',
      ...options?.extraHeaders,
    };

    // Idempotency key for POST requests to prevent duplicate operations
    if (options?.idempotencyKey && method === 'POST') {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    const res = await fetch(url, {
      method,
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      let parsedError: { error?: { type?: string; message?: string } } = {};
      try { parsedError = JSON.parse(errorBody); } catch { /* raw text */ }

      const errorMessage = parsedError.error?.message || errorBody || `HTTP ${res.status}`;
      const errorType = parsedError.error?.type || 'unknown';

      // Classify and handle specific errors
      if (res.status === 422 && errorType === 'insufficient_funds') {
        throw new ApiError('FINTOC_INSUFFICIENT_FUNDS', 'Saldo insuficiente en cuenta bancaria', 422, {
          fintocError: parsedError.error,
        });
      }

      // Retry on 429 (rate limit) or 5xx
      if (retries > 0 && (res.status >= 500 || res.status === 429)) {
        const retryAfter = res.headers.get('retry-after');
        const backoff = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.pow(2, MAX_RETRIES - retries) * 1000;
        await new Promise(resolve => setTimeout(resolve, Math.min(backoff, 30_000)));
        return fintocRequest(method, path, { ...options, retries: retries - 1 });
      }

      throw new ApiError('FINTOC_ERROR', `Fintoc ${res.status}: ${errorMessage}`, 502, {
        statusCode: res.status,
        errorType,
        path,
      });
    }

    // Check for Link header pagination
    const linkHeader = res.headers.get('link');
    const hasMore = linkHeader?.includes('rel="next"') || false;
    const nextLink = hasMore
      ? linkHeader?.match(/<([^>]+)>;\s*rel="next"/)?.[1]
      : undefined;

    const data = await res.json() as T;
    return {
      data,
      meta: { statusCode: res.status, hasMore, nextLink },
    };
  } catch (err) {
    if (err instanceof ApiError) throw err;

    if ((err as Error).name === 'AbortError') {
      if (retries > 0) {
        const backoff = Math.pow(2, MAX_RETRIES - retries) * 1000;
        await new Promise(resolve => setTimeout(resolve, backoff));
        return fintocRequest(method, path, { ...options, retries: retries - 1 });
      }
      throw new ApiError('INTEGRATION_TIMEOUT', 'Timeout al comunicarse con Fintoc', 504, { path });
    }

    if (retries > 0) {
      const backoff = Math.pow(2, MAX_RETRIES - retries) * 1000;
      await new Promise(resolve => setTimeout(resolve, backoff));
      return fintocRequest(method, path, { ...options, retries: retries - 1 });
    }

    throw new ApiError('FINTOC_ERROR', `Error de red al comunicarse con Fintoc: ${(err as Error).message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// JWS Signing
// ---------------------------------------------------------------------------
export async function signTransferBody(body: object, secretKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await jose.importJWK({
    kty: 'oct',
    k: Buffer.from(secretKey).toString('base64url'),
  });
  const jws = await new jose.CompactSign(encoder.encode(JSON.stringify(body)))
    .setProtectedHeader({ alg: 'HS256' })
    .sign(key);
  return jws;
}

// ---------------------------------------------------------------------------
// Transfers (Outbound SPEI)
// ---------------------------------------------------------------------------
export async function createTransfer(
  params: {
    amount: number;
    currency: string;
    counterparty: { holder_id?: string; institution_id?: string; number: string };
    comment: string;
    account_id: string;
    reference_id?: string;
    metadata?: Record<string, string>;
  },
  secretKey?: string,
  idempotencyKey?: string
): Promise<FintocTransfer> {
  const key = getSecretKey(secretKey);
  const body = {
    amount: params.amount,
    currency: params.currency,
    counterparty: params.counterparty,
    comment: params.comment,
    account_id: params.account_id,
    ...(params.reference_id && { reference_id: params.reference_id }),
    ...(params.metadata && { metadata: params.metadata }),
  };

  const jwsSignature = await signTransferBody(body, key);

  const { data } = await fintocRequest<FintocTransfer>('POST', '/transfers', {
    body,
    secretKey,
    idempotencyKey: idempotencyKey || `transfer_${params.reference_id || Date.now()}`,
    baseUrl: FINTOC_BASE_V2,
    extraHeaders: { 'Fintoc-JWS-Signature': jwsSignature },
  });
  return data;
}

export async function getTransfer(transferId: string, secretKey?: string): Promise<FintocTransfer> {
  const { data } = await fintocRequest<FintocTransfer>('GET', `/transfers/${transferId}`, { secretKey });
  return data;
}

export async function listTransfers(
  params?: { since?: string; until?: string; per_page?: number; status?: TransferStatus },
  secretKey?: string
): Promise<FintocTransfer[]> {
  const sp = new URLSearchParams();
  if (params?.since) sp.set('since', params.since);
  if (params?.until) sp.set('until', params.until);
  if (params?.per_page) sp.set('per_page', String(Math.min(params.per_page, MAX_PER_PAGE)));
  if (params?.status) sp.set('status', params.status);
  const qs = sp.toString();

  const { data } = await fintocRequest<FintocTransfer[]>('GET', `/transfers${qs ? `?${qs}` : ''}`, { secretKey });
  return data;
}

// ---------------------------------------------------------------------------
// Payment Intents
// ---------------------------------------------------------------------------
export async function createPaymentIntent(
  params: {
    amount: number;
    currency: string;
    recipient_account: { holder_id?: string; number: string; institution_id?: string };
    metadata?: Record<string, string>;
  },
  idempotencyKey?: string
): Promise<FintocPaymentIntent> {
  const { data } = await fintocRequest<FintocPaymentIntent>('POST', '/payment_intents', {
    body: params,
    idempotencyKey,
  });
  return data;
}

export async function getPaymentIntent(intentId: string): Promise<FintocPaymentIntent> {
  const { data } = await fintocRequest<FintocPaymentIntent>('GET', `/payment_intents/${intentId}`);
  return data;
}

// ---------------------------------------------------------------------------
// Account Numbers (virtual CLABE)
// ---------------------------------------------------------------------------
export async function createAccountNumber(
  holderName: string,
  description: string,
  idempotencyKey?: string,
  secretKey?: string,
  metadata?: Record<string, string>
): Promise<{ id: string; number: string; holder_name: string }> {
  const { data } = await fintocRequest('POST', '/account_numbers', {
    body: { holder_name: holderName, description, ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}) },
    idempotencyKey,
    secretKey,
  });
  return data as { id: string; number: string; holder_name: string };
}

export async function getAccountNumber(
  accountNumberId: string,
  secretKey?: string
): Promise<{ id: string; number: string; holder_name?: string; [key: string]: unknown }> {
  const { data } = await fintocRequest('GET', `/account_numbers/${accountNumberId}`, { secretKey });
  return data as { id: string; number: string; holder_name?: string; [key: string]: unknown };
}

// ---------------------------------------------------------------------------
// Accounts & Movements
// ---------------------------------------------------------------------------
export async function getAccounts(
  secretKey?: string,
  params?: { link_token?: string }
): Promise<FintocAccount[]> {
  const qs = params?.link_token ? `?link_token=${encodeURIComponent(params.link_token)}` : '';
  const { data } = await fintocRequest<FintocAccount[]>('GET', `/accounts${qs}`, { secretKey });
  return data;
}

export async function getAccount(accountId: string, secretKey?: string): Promise<FintocAccount> {
  const { data } = await fintocRequest<FintocAccount>('GET', `/accounts/${accountId}`, { secretKey });
  return data;
}

export async function getMovements(
  accountId: string,
  params?: FintocPaginationParams,
  secretKey?: string
): Promise<FintocMovement[]> {
  const sp = new URLSearchParams();
  if (params?.since) sp.set('since', params.since);
  if (params?.until) sp.set('until', params.until);
  if (params?.per_page) sp.set('per_page', String(Math.min(params?.per_page || DEFAULT_PER_PAGE, MAX_PER_PAGE)));
  if (params?.link_token) sp.set('link_token', params.link_token);
  const qs = sp.toString();

  const { data } = await fintocRequest<FintocMovement[]>(
    'GET',
    `/accounts/${accountId}/movements${qs ? `?${qs}` : ''}`,
    { secretKey }
  );
  return data;
}

/**
 * Fetch all movements for an account using automatic pagination.
 */
export async function getAllMovements(
  accountId: string,
  params?: { since?: string; until?: string },
  secretKey?: string,
  maxPages = 20
): Promise<FintocMovement[]> {
  const allMovements: FintocMovement[] = [];
  let lastDate: string | undefined;
  const perPage = DEFAULT_PER_PAGE;

  for (let page = 0; page < maxPages; page++) {
    const movements = await getMovements(
      accountId,
      { since: params?.since, until: lastDate || params?.until, per_page: perPage },
      secretKey
    );

    if (!movements || movements.length === 0) break;

    const existingIds = new Set(allMovements.map(m => m.id));
    const newMovements = movements.filter(m => !existingIds.has(m.id));
    allMovements.push(...newMovements);

    if (movements.length < perPage) break;

    const sortedByDate = [...movements].sort(
      (a, b) => new Date(a.post_date).getTime() - new Date(b.post_date).getTime()
    );
    const oldestDate = sortedByDate[0]?.post_date;
    if (!oldestDate || oldestDate === lastDate) break;
    lastDate = oldestDate;
  }

  return allMovements;
}

// ---------------------------------------------------------------------------
// CLABE Verification
// ---------------------------------------------------------------------------
export async function verifyCLABE(clabe: string, secretKey?: string) {
  const { data } = await fintocRequest('POST', '/micro_deposits/verify', {
    body: { clabe },
    secretKey,
  });
  return data;
}

// ---------------------------------------------------------------------------
// Webhook Verification
// ---------------------------------------------------------------------------
/**
 * Verify Fintoc webhook signature.
 * Format: `t=<unix_timestamp>,v1=<hmac_hex>`
 * The signed content is `<timestamp>.<payload>`.
 */
export function verifyFintocWebhook(payload: string, signature: string): boolean {
  const secret = process.env.FINTOC_WEBHOOK_SECRET;
  if (!secret || !signature) return false;

  // Parse the t= and v1= components
  const parts = signature.split(',');
  const timestampPart = parts.find(p => p.startsWith('t='));
  const signaturePart = parts.find(p => p.startsWith('v1='));

  if (!timestampPart || !signaturePart) return false;

  const timestamp = timestampPart.slice(2);
  const sig = signaturePart.slice(3);

  if (!timestamp || !sig) return false;

  // Check timestamp tolerance (5 minutes)
  const TOLERANCE_SECONDS = 300;
  const now = Math.floor(Date.now() / 1000);
  const webhookTime = parseInt(timestamp, 10);
  if (isNaN(webhookTime) || Math.abs(now - webhookTime) > TOLERANCE_SECONDS) return false;

  // Compute expected HMAC over "timestamp.payload"
  const signedContent = `${timestamp}.${payload}`;
  const expected = crypto.createHmac('sha256', secret).update(signedContent).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function centavosToPesos(centavos: number): number {
  return Math.round(centavos) / 100;
}

export function generateIdempotencyKey(companyId: string, reference: string): string {
  const hash = crypto.createHash('sha256')
    .update(`${companyId}:${reference}:${new Date().toISOString().split('T')[0]}`)
    .digest('hex')
    .substring(0, 32);
  return `idem_${hash}`;
}
