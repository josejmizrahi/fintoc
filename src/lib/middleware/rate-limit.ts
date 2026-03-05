import { ApiError } from '@/lib/utils/errors';

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

// In-memory rate limiter (use Upstash Redis in production)
const store = new Map<string, { count: number; resetAt: number }>();

const CONFIGS: Record<string, RateLimitConfig> = {
  auth: { maxRequests: 10, windowMs: 60_000 },
  write: { maxRequests: 60, windowMs: 60_000 },
  read: { maxRequests: 120, windowMs: 60_000 },
  batch: { maxRequests: 5, windowMs: 60_000 },
};

function getClientIdentifier(req: Request, userId?: string): string {
  if (userId) return `user:${userId}`;
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
  return `ip:${ip}`;
}

export function checkRateLimit(
  req: Request,
  type: keyof typeof CONFIGS = 'read',
  userId?: string
): void {
  const config = CONFIGS[type];
  if (!config) return;

  const key = `${type}:${getClientIdentifier(req, userId)}`;
  const now = Date.now();

  const entry = store.get(key);
  if (!entry || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + config.windowMs });
    return;
  }

  entry.count++;
  if (entry.count > config.maxRequests) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    throw new ApiError('RATE_LIMITED', 'Demasiadas requests', 429, {
      retry_after: retryAfter,
    });
  }
}

// Cleanup stale entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now >= entry.resetAt) {
      store.delete(key);
    }
  }
}, 60_000);
