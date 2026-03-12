import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { ApiError } from '@/lib/utils/errors';
import { hasDB, query, update } from '@/lib/db';
import { writeAuditLog } from '@/lib/middleware/audit';

/**
 * POST /api/sat/upload
 * Accepts .cer and .key files as multipart/form-data.
 * Stores file content as base64 in integrations.config JSONB.
 */
export const POST = createHandler(async (req) => {
  return withAuth(async (_req, ctx) => {
    if (!hasDB()) throw new ApiError('INTERNAL_ERROR', 'DB no configurada', 500);

    const formData = await req.formData();
    const cerFile = formData.get('cer') as File | null;
    const keyFile = formData.get('key') as File | null;
    const keyPassword = formData.get('keyPassword') as string | null;
    const rfcEmisor = formData.get('rfcEmisor') as string | null;

    if (!cerFile && !keyFile) {
      throw new ApiError('VALIDATION_ERROR', 'Se requiere al menos un archivo (.cer o .key)', 400);
    }

    if (cerFile) {
      const name = cerFile.name.toLowerCase();
      if (!name.endsWith('.cer')) {
        throw new ApiError('VALIDATION_ERROR', 'El archivo de certificado debe tener extension .cer', 400);
      }
      if (cerFile.size > 10 * 1024) {
        throw new ApiError('VALIDATION_ERROR', 'El archivo .cer no debe exceder 10KB', 400);
      }
    }

    if (keyFile) {
      const name = keyFile.name.toLowerCase();
      if (!name.endsWith('.key')) {
        throw new ApiError('VALIDATION_ERROR', 'El archivo de llave debe tener extension .key', 400);
      }
      if (keyFile.size > 10 * 1024) {
        throw new ApiError('VALIDATION_ERROR', 'El archivo .key no debe exceder 10KB', 400);
      }
    }

    const updates: Record<string, string> = {};

    if (cerFile) {
      const cerBuffer = await cerFile.arrayBuffer();
      updates.certBase64 = Buffer.from(cerBuffer).toString('base64');
      updates.certFileName = cerFile.name;
    }

    if (keyFile) {
      const keyBuffer = await keyFile.arrayBuffer();
      updates.keyBase64 = Buffer.from(keyBuffer).toString('base64');
      updates.keyFileName = keyFile.name;
    }

    if (keyPassword) updates.keyPassword = keyPassword;
    if (rfcEmisor) updates.rfcEmisor = rfcEmisor;

    const { data: existing } = await query('integrations', {
      match: { company_id: ctx.company_id, provider: 'sat' },
      single: true,
    });

    const existingConfig = (existing?.config as Record<string, string>) || {};
    const mergedConfig = { ...existingConfig, ...updates };

    if (existing) {
      await update(
        'integrations',
        {
          config: mergedConfig,
          cert_uploaded_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { company_id: ctx.company_id, provider: 'sat' },
      );
    } else {
      const { insert: dbInsert } = await import('@/lib/db');
      await dbInsert('integrations', {
        company_id: ctx.company_id,
        provider: 'sat',
        config: mergedConfig,
        cert_uploaded_at: new Date().toISOString(),
      });
    }

    const uploadedFiles = [];
    if (cerFile) uploadedFiles.push(cerFile.name);
    if (keyFile) uploadedFiles.push(keyFile.name);

    writeAuditLog({
      company_id: ctx.company_id,
      user_id: ctx.user_id,
      action: 'sat.xml_uploaded',
      entity_type: 'sat',
      entity_id: ctx.company_id,
      metadata: { files: uploadedFiles, rfc_emisor: rfcEmisor },
    });

    return Response.json({
      data: {
        message: `Archivos subidos: ${uploadedFiles.join(', ')}`,
        files: {
          cer: cerFile ? { name: cerFile.name, size: cerFile.size } : null,
          key: keyFile ? { name: keyFile.name, size: keyFile.size } : null,
        },
      },
    });
  })(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
