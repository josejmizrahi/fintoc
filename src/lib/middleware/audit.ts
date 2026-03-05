import { getAdminClient } from '@/lib/supabase/admin';

interface AuditEntry {
  company_id: string | number;
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string | number;
  changes?: { before?: Record<string, unknown>; after?: Record<string, unknown> };
  metadata?: Record<string, unknown>;
}

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    const admin = getAdminClient();
    await admin.from('audit_log').insert({
      company_id: entry.company_id,
      user_id: entry.user_id,
      action: entry.action,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id,
      changes: entry.changes || null,
      metadata: entry.metadata || null,
    });
  } catch (err) {
    // Audit log failures should not break the main flow
    console.error('Failed to write audit log:', err);
  }
}
