import crypto from 'crypto';
import { getAdminClient } from '@/lib/supabase/admin';
import { verifyCronSecret } from '@/lib/middleware/cron-auth';

const RETRY_WINDOW_HOURS = 48;
const MAX_RETRY_ATTEMPTS = 3;
const BATCH_LIMIT = 50;

export async function GET(req: Request): Promise<Response> {
  const authError = verifyCronSecret(req);
  if (authError) return authError;

  const admin = getAdminClient();

  try {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - RETRY_WINDOW_HOURS);

    const { data: unprocessed } = await admin.from('webhook_logs')
      .select('id, provider, event_type, payload, error, retry_count')
      .eq('processed', false)
      .gte('created_at', cutoff.toISOString())
      .order('created_at', { ascending: true })
      .limit(BATCH_LIMIT);

    let retried = 0;
    let succeeded = 0;
    let skippedMaxRetries = 0;

    for (const log of (unprocessed || [])) {
      const retryCount = (log as Record<string, unknown>).retry_count as number ?? 0;

      // Skip if max retries exceeded
      if (retryCount >= MAX_RETRY_ATTEMPTS) {
        skippedMaxRetries++;
        continue;
      }

      // Increment retry count before attempting
      await admin.from('webhook_logs').update({
        retry_count: retryCount + 1,
      }).eq('id', log.id);

      try {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

        const webhookUrl = `${baseUrl}/api/webhooks/${log.provider}`;
        // Generate HMAC retry token using the webhook secret
        const retrySecret = process.env.WEBHOOK_RETRY_SECRET || process.env.FINTOC_SECRET_KEY || '';
        const retryPayload = `${log.id}:${log.provider}`;
        const retrySignature = crypto.createHmac('sha256', retrySecret).update(retryPayload).digest('hex');

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'x-webhook-retry': 'true',
          'x-webhook-log-id': log.id,
          'x-webhook-retry-signature': retrySignature,
        };

        // Add auth headers for Syntage retries
        if (log.provider === 'syntage') {
          headers['x-webhook-secret'] = process.env.SYNTAGE_WEBHOOK_SECRET || '';
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);

        try {
          const response = await fetch(webhookUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(log.payload),
            signal: controller.signal,
          });

          if (response.ok) {
            await admin.from('webhook_logs').update({
              processed: true,
              error: null,
            }).eq('id', log.id);
            succeeded++;
          } else {
            const errorText = await response.text().catch(() => 'Unknown');
            await admin.from('webhook_logs').update({
              error: `Retry failed (${response.status}): ${errorText.slice(0, 500)}`,
            }).eq('id', log.id);
          }
        } finally {
          clearTimeout(timeout);
        }

        retried++;
      } catch (err) {
        await admin.from('webhook_logs').update({
          error: `Retry error: ${err instanceof Error ? err.message : 'Unknown'}`,
        }).eq('id', log.id);
        retried++;
      }
    }

    return Response.json({
      data: {
        found: (unprocessed || []).length,
        retried,
        succeeded,
        skipped_max_retries: skippedMaxRetries,
      },
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
