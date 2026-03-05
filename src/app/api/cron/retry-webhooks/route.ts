import { getAdminClient } from '@/lib/supabase/admin';

export async function GET(req: Request): Promise<Response> {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getAdminClient();

  try {
    // Find unprocessed webhook logs from the last 24 hours
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - 24);

    const { data: unprocessed } = await admin.from('webhook_logs')
      .select('id, provider, event_type, payload, error')
      .eq('processed', false)
      .gte('created_at', cutoff.toISOString())
      .order('created_at', { ascending: true })
      .limit(50);

    let retried = 0;
    let succeeded = 0;

    for (const log of (unprocessed || [])) {
      try {
        // Re-dispatch the webhook event internally
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';

        const webhookUrl = `${baseUrl}/api/webhooks/${log.provider}`;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };

        // Add appropriate auth headers for retry
        if (log.provider === 'syntage') {
          headers['x-webhook-secret'] = process.env.SYNTAGE_WEBHOOK_SECRET || '';
        }
        // For fintoc, we can't re-sign, so mark as retry
        headers['x-webhook-retry'] = 'true';
        headers['x-webhook-log-id'] = log.id;

        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(log.payload),
        });

        if (response.ok) {
          await admin.from('webhook_logs').update({ processed: true, error: null }).eq('id', log.id);
          succeeded++;
        }
        retried++;
      } catch {
        retried++;
      }
    }

    return Response.json({ data: { found: (unprocessed || []).length, retried, succeeded } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
