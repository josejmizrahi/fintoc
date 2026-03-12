/**
 * httpOnly cookie helpers for auth tokens.
 *
 * Tokens are stored in httpOnly cookies that the browser sends automatically.
 * This eliminates XSS-based token theft since JavaScript cannot read httpOnly cookies.
 */

const ACCESS_TOKEN_COOKIE = 'qb_access_token';
const REFRESH_TOKEN_COOKIE = 'qb_refresh_token';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

interface CookieOptions {
  maxAge?: number;
}

function buildCookie(name: string, value: string, opts: CookieOptions = {}): string {
  const maxAge = opts.maxAge ?? 3600; // default 1h
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Max-Age=${maxAge}`,
  ];
  if (IS_PRODUCTION) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function buildDeleteCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/**
 * Creates Set-Cookie headers for access + refresh tokens.
 */
export function setAuthCookies(
  accessToken: string,
  refreshToken: string,
): string[] {
  return [
    buildCookie(ACCESS_TOKEN_COOKIE, accessToken, { maxAge: 3600 }),       // 1h
    buildCookie(REFRESH_TOKEN_COOKIE, refreshToken, { maxAge: 30 * 86400 }), // 30d
  ];
}

/**
 * Creates Set-Cookie headers to clear auth cookies.
 */
export function clearAuthCookies(): string[] {
  return [
    buildDeleteCookie(ACCESS_TOKEN_COOKIE),
    buildDeleteCookie(REFRESH_TOKEN_COOKIE),
  ];
}

/**
 * Extracts the access token from the request cookies.
 * Falls back to Authorization header for backward compatibility
 * (e.g. cron jobs, external API clients).
 */
export function extractAccessToken(req: Request): string | null {
  // 1. Try httpOnly cookie
  const cookieHeader = req.headers.get('cookie');
  if (cookieHeader) {
    const token = parseCookieValue(cookieHeader, ACCESS_TOKEN_COOKIE);
    if (token) return token;
  }

  // 2. Fallback to Bearer token (backward compat, cron, external clients)
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    return auth.slice(7);
  }

  return null;
}

/**
 * Extracts the refresh token from the request cookies.
 */
export function extractRefreshToken(req: Request): string | null {
  const cookieHeader = req.headers.get('cookie');
  if (!cookieHeader) return null;
  return parseCookieValue(cookieHeader, REFRESH_TOKEN_COOKIE);
}

function parseCookieValue(cookieHeader: string, name: string): string | null {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  if (!match) return null;
  return decodeURIComponent(match[1]);
}

/**
 * Appends Set-Cookie headers to an existing Response.
 */
export function withCookies(response: Response, cookies: string[]): Response {
  const headers = new Headers(response.headers);
  for (const cookie of cookies) {
    headers.append('Set-Cookie', cookie);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
