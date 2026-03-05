import { getAdminClient } from '@/lib/supabase/admin';

export async function POST(req: Request): Promise<Response> {
  try {
    // Verify token
    const authHeader = req.headers.get('authorization');
    const expectedToken = process.env.ODOO_WEBHOOK_TOKEN;

    if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
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
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
