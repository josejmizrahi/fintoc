/**
 * Robust retry with exponential backoff + jitter.
 *
 * Features:
 * - Exponential backoff with decorrelated jitter (AWS-style)
 * - Configurable max delay cap
 * - AbortSignal support for cancellation
 * - Error classification callback (retryable vs non-retryable)
 * - onRetry hook for logging/metrics
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in ms (default: 1000) */
  baseDelay?: number;
  /** Maximum delay cap in ms (default: 30000) */
  maxDelay?: number;
  /** Return false to stop retrying on this error */
  retryOn?: (err: unknown, attempt: number) => boolean;
  /** Called before each retry — useful for logging */
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions,
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 3;
  const baseDelay = opts?.baseDelay ?? 1000;
  const maxDelay = opts?.maxDelay ?? 30_000;
  const retryOn = opts?.retryOn ?? (() => true);

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    opts?.signal?.throwIfAborted();

    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt >= maxRetries || !retryOn(err, attempt)) throw err;

      // Decorrelated jitter: delay = min(maxDelay, random(baseDelay, prevDelay * 3))
      const prevDelay = baseDelay * Math.pow(2, attempt);
      const jitter = baseDelay + Math.random() * (prevDelay - baseDelay);
      const delay = Math.min(maxDelay, Math.ceil(jitter));

      opts?.onRetry?.(err, attempt + 1, delay);

      await sleep(delay, opts?.signal);
    }
  }
  throw lastError;
}

/**
 * Classify whether an error is retryable based on common patterns.
 */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // Network / transient errors
    if (msg.includes('fetch failed') || msg.includes('econnrefused') ||
        msg.includes('econnreset') || msg.includes('etimedout') ||
        msg.includes('socket hang up') || msg.includes('network') ||
        msg.includes('abort')) {
      return true;
    }
  }

  // HTTP status-based classification
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const status = (err as { status: number }).status;
    // Never retry auth/permission/validation errors
    if (status === 401 || status === 403 || status === 404 || status === 422) return false;
    // 408 Request Timeout, 429 Too Many Requests, 5xx Server Errors
    return status === 408 || status === 429 || status >= 500;
  }

  // Check for error code property (e.g. Supabase, custom ApiError)
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code: string }).code;
    if (code === 'SYNC_IN_PROGRESS' || code === 'UNAUTHORIZED' || code === 'FORBIDDEN') return false;
  }

  return true; // Default: assume retryable
}

/**
 * Non-retryable: 4xx client errors (except 408, 429)
 */
export function isNonRetryableError(err: unknown): boolean {
  return !isRetryableError(err);
}

/** Abortable sleep */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}
