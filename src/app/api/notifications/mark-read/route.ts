import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { markReadSchema } from '@/lib/validations/schemas';
import { ApiError } from '@/lib/utils/errors';
import { getAdminClient } from '@/lib/supabase/admin';

export const POST = createHandler(async (req) => {
  return withAuth(async (_req, ctx) => {
    let body: unknown;
    try { body = await _req.json(); } catch { throw new ApiError('VALIDATION_ERROR', 'JSON invalido', 400); }

    const result = markReadSchema.safeParse(body);
    if (!result.success) throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400);

    const admin = getAdminClient();

    if (result.data.notification_ids && result.data.notification_ids.length > 0) {
      await admin.from('notifications').update({ read: true })
        .in('id', result.data.notification_ids).eq('user_id', ctx.user_id);
    } else {
      // Mark all as read
      await admin.from('notifications').update({ read: true })
        .eq('user_id', ctx.user_id).eq('company_id', ctx.company_id).eq('read', false);
    }

    return Response.json({ data: { message: 'Notificaciones marcadas como leidas' } });
  })(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
