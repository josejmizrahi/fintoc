/**
 * Fintoc API Client
 * Shared by: onboarding route, catch-all route, webhook route
 */

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
