import crypto from 'crypto';
import * as jose from 'jose';
import { ApiError } from '@/lib/utils/errors';

const FINTOC_BASE = 'https://api.fintoc.com/v1';
const TIMEOUT = 30_000;
const MAX_RETRIES = 3;

async function fintocRequest(
  method: string,
  path: string,
  body?: unknown,
  secretKey?: string,
  retries = MAX_RETRIES
): Promise<unknown> {
  const key = secretKey || process.env.FINTOC_SECRET_KEY;
  if (!key) {
    throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Fintoc secret key no configurada', 422);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    };

    const res = await fetch(`${FINTOC_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'Unknown error');
      if (retries > 0 && (res.status >= 500 || res.status === 429)) {
        const delay = Math.pow(2, MAX_RETRIES - retries) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        return fintocRequest(method, path, body, secretKey, retries - 1);
      }
      throw new ApiError('FINTOC_ERROR', `Fintoc error: ${errorText}`, 502);
    }

    return res.json();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if ((err as Error).name === 'AbortError') {
      if (retries > 0) {
        const delay = Math.pow(2, MAX_RETRIES - retries) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        return fintocRequest(method, path, body, secretKey, retries - 1);
      }
      throw new ApiError('INTEGRATION_TIMEOUT', 'Timeout al comunicarse con Fintoc', 504);
    }
    throw new ApiError('FINTOC_ERROR', 'Error al comunicarse con Fintoc', 502);
  } finally {
    clearTimeout(timeout);
  }
}

// --- JWS Signing ---
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

// --- Transfers (Outbound SPEI) ---
export async function createTransfer(
  params: {
    amount: number;
    currency: string;
    destination_account: { institution_id?: string; number: string };
    concept: string;
    reference_id?: string;
  },
  secretKey?: string
) {
  return fintocRequest('POST', '/transfers', params, secretKey);
}

export async function getTransfer(transferId: string, secretKey?: string) {
  return fintocRequest('GET', `/transfers/${transferId}`, undefined, secretKey);
}

// --- Payment Intents ---
export async function createPaymentIntent(params: {
  amount: number;
  currency: string;
  recipient_account: { clabe: string };
}) {
  return fintocRequest('POST', '/payment_intents', params);
}

export async function getPaymentIntent(intentId: string) {
  return fintocRequest('GET', `/payment_intents/${intentId}`);
}

// --- Account Numbers ---
export async function createAccountNumber(holderName: string, description: string) {
  return fintocRequest('POST', '/account_numbers', {
    holder_name: holderName,
    description,
  });
}

// --- Accounts & Movements ---
export async function getAccounts(secretKey?: string) {
  return fintocRequest('GET', '/accounts', undefined, secretKey);
}

export async function getAccount(accountId: string, secretKey?: string) {
  return fintocRequest('GET', `/accounts/${accountId}`, undefined, secretKey);
}

export async function getMovements(
  accountId: string,
  params?: { since?: string; until?: string; per_page?: number },
  secretKey?: string
) {
  const searchParams = new URLSearchParams();
  if (params?.since) searchParams.set('since', params.since);
  if (params?.until) searchParams.set('until', params.until);
  if (params?.per_page) searchParams.set('per_page', String(params.per_page));
  const query = searchParams.toString();
  return fintocRequest(
    'GET',
    `/accounts/${accountId}/movements${query ? `?${query}` : ''}`,
    undefined,
    secretKey
  );
}

// --- CLABE Verification ---
export async function verifyCLABE(clabe: string, secretKey?: string) {
  return fintocRequest('POST', '/micro_deposits/verify', { clabe }, secretKey);
}

// --- Webhook Verification ---
export function verifyFintocWebhook(payload: string, signature: string): boolean {
  const secret = process.env.FINTOC_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}
