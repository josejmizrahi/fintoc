import crypto from 'crypto';

/**
 * Validates the cron secret from the request Authorization header.
 * Uses timing-safe comparison to prevent timing attacks.
 * Returns null if valid, or a Response if unauthorized.
 */
export function verifyCronSecret(req: Request): Response | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json(
      { error: { code: 'CRON_NOT_CONFIGURED', message: 'CRON_SECRET not configured' } },
      { status: 500 }
    );
  }

  const secret = req.headers.get('authorization')?.replace('Bearer ', '') || '';
  const expected = Buffer.from(cronSecret, 'utf8');
  const received = Buffer.from(secret, 'utf8');

  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return Response.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret' } },
      { status: 401 }
    );
  }

  return null; // Valid
}
