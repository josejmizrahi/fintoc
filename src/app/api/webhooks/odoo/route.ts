import crypto from 'crypto';
import { getAdminClient } from '@/lib/supabase/admin';

export async function POST(req: Request): Promise<Response> {
  try {
    // Verify token with timing-safe comparison
    const authHeader = req.headers.get('authorization');
    const expectedToken = process.env.ODOO_WEBHOOK_TOKEN;

    if (!expectedToken) {
      return Response.json({ error: { code: 'WEBHOOK_NOT_CONFIGURED', message: 'Webhook token not configured' } }, { status: 500 });
    }

    const receivedToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const expected = Buffer.from(expectedToken, 'utf8');
    const received = Buffer.from(receivedToken, 'utf8');

    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      return Response.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid webhook token' } }, { status: 401 });
    }

    const payload = await req.json() as {
      type: string;
      data: Record<string, unknown>;
    };

    const admin = getAdminClient();

    await admin.from('webhook_logs').insert({
      provider: 'odoo',
      event_type: payload.type,
      payload,
      processed: true, // Odoo webhooks are simple acknowledgments
    });

    return Response.json({ received: true });
  } catch {
    return Response.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal error' } }, { status: 500 });
  }
}
