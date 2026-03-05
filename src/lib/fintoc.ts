/**
 * Fintoc API Client
 * Shared by: onboarding route, catch-all route, webhook route
 *
 * Supports: Payment Intents, Outbound Transfers (JWS), Account Numbers,
 *           CLABE Verification, Movements, Webhooks
 */

import crypto from "crypto";
import { withRetry } from "./retry";

const FINTOC_BASE = "https://api.fintoc.com/v1";

// Don't retry auth errors
const isRetryable = (err: unknown) =>
  !(err instanceof Error && err.message.includes("API key de Fintoc invalida"));

export async function fintocGet(
  path: string,
  secretKey: string,
  params?: Record<string, string>,
): Promise<unknown> {
  return withRetry(async () => {
    const url = new URL(`${FINTOC_BASE}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString(), {
      headers: { Authorization: secretKey },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401) throw new Error("API key de Fintoc invalida");
    if (!res.ok)
      throw new Error(
        `Fintoc HTTP ${res.status}: ${await res.text().catch(() => "")}`,
      );
    return res.json();
  }, { retryOn: isRetryable });
}

export async function fintocPost(
  path: string,
  secretKey: string,
  body: Record<string, unknown>,
  version: "v1" | "v2" = "v1",
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const base = version === "v2" ? "https://api.fintoc.com/v2" : FINTOC_BASE;
  try {
    return await withRetry(async () => {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: secretKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true as const, data };
      // Don't retry client errors (4xx)
      if (res.status >= 400 && res.status < 500) {
        return {
          ok: false as const,
          error: data?.error?.message || data?.message || res.statusText,
        };
      }
      throw new Error(`Fintoc HTTP ${res.status}`);
    }, { retryOn: isRetryable });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}

// ── JWS Signing for Outbound Transfers ──

/**
 * Sign a request body with RSA-SHA256 JWS for Fintoc outbound transfers.
 * The private key should be in PEM format stored in FINTOC_JWS_PRIVATE_KEY env.
 */
function jwsSign(payload: string, privateKeyPem: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(payload).toString("base64url");
  const signable = `${header}.${body}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signable);
  const signature = sign.sign(privateKeyPem, "base64url");
  return `${signable}.${signature}`;
}

/**
 * POST with JWS signature header for Fintoc endpoints that require it
 * (outbound_transfers, account_verifications).
 */
export async function fintocPostSigned(
  path: string,
  secretKey: string,
  body: Record<string, unknown>,
  privateKeyPem: string,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  try {
    return await withRetry(async () => {
      const payload = JSON.stringify(body);
      const jws = jwsSign(payload, privateKeyPem);
      const res = await fetch(`${FINTOC_BASE}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: secretKey,
          "Fintoc-JWS-Signature": jws,
        },
        body: payload,
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true as const, data };
      if (res.status >= 400 && res.status < 500) {
        return { ok: false as const, error: data?.error?.message || data?.message || res.statusText };
      }
      throw new Error(`Fintoc HTTP ${res.status}`);
    }, { retryOn: isRetryable });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}

// ── Outbound Transfers (SPEI Dispersions) ──

export interface OutboundTransferRequest {
  amount: number;          // In centavos
  currency?: string;       // Default: MXN
  counterparty: {
    account_type: "CLABE";
    account_number: string;
    holder_name?: string;
    institution_id?: string;
  };
  reference_id?: string;
  metadata?: Record<string, string>;
}

export async function fintocOutboundTransfer(
  secretKey: string,
  privateKeyPem: string,
  transfer: OutboundTransferRequest,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  return fintocPostSigned("/outbound_transfers", secretKey, {
    amount: transfer.amount,
    currency: transfer.currency || "MXN",
    counterparty: transfer.counterparty,
    reference_id: transfer.reference_id,
    metadata: transfer.metadata,
  }, privateKeyPem);
}

// ── Account Numbers (Dedicated CLABEs per customer) ──

export async function fintocCreateAccountNumber(
  secretKey: string,
  metadata?: Record<string, string>,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  return fintocPost("/account_numbers", secretKey, {
    metadata: metadata || {},
  });
}

export async function fintocGetAccountNumber(
  secretKey: string,
  accountNumberId: string,
): Promise<unknown> {
  return fintocGet(`/account_numbers/${accountNumberId}`, secretKey);
}

// ── CLABE Verification (Micro-deposit) ──

export async function fintocVerifyClabe(
  secretKey: string,
  privateKeyPem: string,
  clabe: string,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  return fintocPostSigned("/account_verifications", secretKey, {
    account: {
      type: "CLABE",
      number: clabe,
    },
  }, privateKeyPem);
}

// ── Webhook Signature Verification ──

export function verifyFintocWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}
