import crypto from 'crypto';
import { z } from 'zod';
import { getAdminClient } from '@/lib/supabase/admin';

const odooWebhookSchema = z.object({
  type: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});

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

    const parsed = odooWebhookSchema.safeParse(await req.json());
    const admin = getAdminClient();

    if (!parsed.success) {
      await admin.from('webhook_logs').insert({
        provider: 'odoo',
        event_type: 'unknown',
        payload: null,
        processed: false,
        error: `Validation failed: ${parsed.error.message}`,
      });
      return Response.json({ received: true });
    }

    const payload = parsed.data;

    // Idempotency: skip if we already logged this exact event
    const eventId = (payload.data?.id as string) || null;
    if (eventId) {
      const { data: existing } = await admin.from('webhook_logs')
        .select('id, payload')
        .eq('provider', 'odoo')
        .eq('event_type', payload.type)
        .eq('processed', true)
        .limit(10);

      const isDuplicate = (existing || []).some((log: { payload?: { data?: Record<string, unknown> } }) => {
        return (log.payload?.data?.id as string) === eventId;
      });

      if (isDuplicate) {
        return Response.json({ received: true, deduplicated: true });
      }
    }

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
