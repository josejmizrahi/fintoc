import crypto from 'crypto';
import * as jose from 'jose';
import { ApiError } from '@/lib/utils/errors';

// ---------------------------------------------------------------------------
// Fintoc API Client — Professional integration
// https://docs.fintoc.com/
// ---------------------------------------------------------------------------

const FINTOC_BASE = 'https://api.fintoc.com/v1';
const DEFAULT_TIMEOUT = 30_000;
const MAX_RETRIES = 3;
const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 300;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type TransferStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'rejected';
export type MovementType = 'credit' | 'debit';
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
  destination_account: {
    holder_id?: string;
    holder_name?: string;
    number: string;
    institution?: { id: string; name: string };
  };
  concept: string;
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
  }
): Promise<{ data: T; meta: FintocRequestMeta }> {
  const retries = options?.retries ?? MAX_RETRIES;
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const key = getSecretKey(options?.secretKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const url = path.startsWith('http') ? path : `${FINTOC_BASE}${path}`;
    const headers: Record<string, string> = {
      'Authorization': key,
      'Content-Type': 'application/json',
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
    destination_account: { institution_id?: string; number: string };
    concept: string;
    reference_id?: string;
    metadata?: Record<string, string>;
  },
  secretKey?: string,
  idempotencyKey?: string
): Promise<FintocTransfer> {
  const { data } = await fintocRequest<FintocTransfer>('POST', '/transfers', {
    body: params,
    secretKey,
    idempotencyKey: idempotencyKey || `transfer_${params.reference_id || Date.now()}`,
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
  idempotencyKey?: string
): Promise<{ id: string; number: string; holder_name: string }> {
  const { data } = await fintocRequest('POST', '/account_numbers', {
    body: { holder_name: holderName, description },
    idempotencyKey,
  });
  return data as { id: string; number: string; holder_name: string };
}

// ---------------------------------------------------------------------------
// Accounts & Movements
// ---------------------------------------------------------------------------
export async function getAccounts(secretKey?: string, linkToken?: string): Promise<FintocAccount[]> {
  const qs = linkToken ? `?link_token=${encodeURIComponent(linkToken)}` : '';
  const { data } = await fintocRequest<FintocAccount[]>('GET', `/accounts${qs}`, { secretKey });
  return data;
}

export async function getAccount(accountId: string, secretKey?: string, linkToken?: string): Promise<FintocAccount> {
  const qs = linkToken ? `?link_token=${encodeURIComponent(linkToken)}` : '';
  const { data } = await fintocRequest<FintocAccount>('GET', `/accounts/${accountId}${qs}`, { secretKey });
  return data;
}

export async function getMovements(
  accountId: string,
  params?: FintocPaginationParams,
  secretKey?: string,
  linkToken?: string,
): Promise<FintocMovement[]> {
  const sp = new URLSearchParams();
  if (params?.since) sp.set('since', params.since);
  if (params?.until) sp.set('until', params.until);
  if (params?.per_page) sp.set('per_page', String(Math.min(params?.per_page || DEFAULT_PER_PAGE, MAX_PER_PAGE)));
  if (params?.link_token) sp.set('link_token', params.link_token);
  if (linkToken && !params?.link_token) sp.set('link_token', linkToken);
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
  maxPages = 20,
  linkToken?: string,
): Promise<FintocMovement[]> {
  const allMovements: FintocMovement[] = [];
  let lastDate: string | undefined;
  const perPage = DEFAULT_PER_PAGE;

  for (let page = 0; page < maxPages; page++) {
    const movements = await getMovements(
      accountId,
      { since: params?.since, until: lastDate || params?.until, per_page: perPage },
      secretKey,
      linkToken,
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
export function verifyFintocWebhook(payload: string, signature: string): boolean {
  const secret = process.env.FINTOC_WEBHOOK_SECRET;
  if (!secret || !signature) return false;

  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
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
