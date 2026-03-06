/**
 * Typed Database Layer
 *
 * Replaces the untyped `query/insert/update` from lib/db.ts with
 * table-specific, fully-typed functions. Uses the existing Supabase
 * client under the hood but enforces type safety at the call site.
 *
 * Usage:
 *   const vendors = await db.vendors.findMany({ companyId: '123' });
 *   await db.vendors.upsert(vendorRow, 'company_id,rfc');
 */
import { getAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

// ---------------------------------------------------------------------------
// Table row types (re-export for convenience)
// ---------------------------------------------------------------------------
type Tables = Database['public']['Tables'];

export type VendorRow = Tables['vendors']['Row'];
export type VendorInsert = Tables['vendors']['Insert'];
export type CustomerRow = Tables['customers']['Row'];
export type CustomerInsert = Tables['customers']['Insert'];
export type InvoiceRow = Tables['invoices']['Row'];
export type InvoiceInsert = Tables['invoices']['Insert'];
export type PaymentRow = Tables['payments']['Row'];
export type PaymentInsert = Tables['payments']['Insert'];
export type IntegrationRow = Tables['integrations']['Row'];
export type IntegrationInsert = Tables['integrations']['Insert'];
export type SyncHistoryRow = Tables['sync_history']['Row'];
export type SyncHistoryInsert = Tables['sync_history']['Insert'];
export type BankAccountRow = Tables['bank_accounts']['Row'];
export type BankAccountInsert = Tables['bank_accounts']['Insert'];
export type BankMovementRow = Tables['bank_movements']['Row'];
export type BankMovementInsert = Tables['bank_movements']['Insert'];
export type SyntageExtractionRow = Tables['syntage_extractions']['Row'];
export type SyntageExtractionInsert = Tables['syntage_extractions']['Insert'];

// ---------------------------------------------------------------------------
// Typed table accessor
// ---------------------------------------------------------------------------

type TableName = keyof Tables;

interface FindOptions {
  match?: Record<string, unknown>;
  order?: { column: string; ascending?: boolean };
  limit?: number;
}

/**
 * Generic typed table helper. Provides findMany / findOne / insert / update / upsert
 * scoped to a specific table, with Supabase's PostgREST under the hood.
 */
function createTableAccessor<
  TRow extends Record<string, unknown>,
  TInsert extends Record<string, unknown>,
>(tableName: TableName) {
  function admin(): SupabaseClient {
    return getAdminClient();
  }

  return {
    async findMany(
      match?: Record<string, unknown>,
      options?: { order?: { column: string; ascending?: boolean }; limit?: number },
    ): Promise<TRow[]> {
      let q = admin().from(tableName).select('*');
      if (match) {
        for (const [key, val] of Object.entries(match)) {
          q = q.eq(key, val);
        }
      }
      if (options?.order) {
        q = q.order(options.order.column, { ascending: options.order.ascending ?? false });
      }
      if (options?.limit) {
        q = q.limit(options.limit);
      }
      const { data, error } = await q;
      if (error) throw new Error(`DB findMany(${tableName}): ${error.message}`);
      return (data ?? []) as TRow[];
    },

    async findOne(match: Record<string, unknown>): Promise<TRow | null> {
      let q = admin().from(tableName).select('*');
      for (const [key, val] of Object.entries(match)) {
        q = q.eq(key, val);
      }
      const { data, error } = await q.limit(1).maybeSingle();
      if (error) throw new Error(`DB findOne(${tableName}): ${error.message}`);
      return (data as TRow) ?? null;
    },

    async insert(row: TInsert | TInsert[]): Promise<TRow[]> {
      const { data, error } = await admin()
        .from(tableName)
        .insert(row as Record<string, unknown> | Record<string, unknown>[])
        .select();
      if (error) throw new Error(`DB insert(${tableName}): ${error.message}`);
      return (data ?? []) as TRow[];
    },

    async update(
      values: Partial<TRow>,
      match: Record<string, unknown>,
    ): Promise<TRow[]> {
      let q = admin().from(tableName).update(values as Record<string, unknown>);
      for (const [key, val] of Object.entries(match)) {
        q = q.eq(key, val);
      }
      const { data, error } = await q.select();
      if (error) throw new Error(`DB update(${tableName}): ${error.message}`);
      return (data ?? []) as TRow[];
    },

    async upsert(
      rows: TInsert | TInsert[],
      onConflict: string,
    ): Promise<TRow[]> {
      const { data, error } = await admin()
        .from(tableName)
        .upsert(rows as Record<string, unknown> | Record<string, unknown>[], {
          onConflict,
          ignoreDuplicates: false,
        })
        .select();
      if (error) throw new Error(`DB upsert(${tableName}): ${error.message}`);
      return (data ?? []) as TRow[];
    },

    async count(match?: Record<string, unknown>): Promise<number> {
      let q = admin().from(tableName).select('*', { count: 'exact', head: true });
      if (match) {
        for (const [key, val] of Object.entries(match)) {
          q = q.eq(key, val);
        }
      }
      const { count, error } = await q;
      if (error) throw new Error(`DB count(${tableName}): ${error.message}`);
      return count ?? 0;
    },

    /** Raw Supabase query builder for complex queries */
    query() {
      return admin().from(tableName).select('*');
    },
  };
}

// ---------------------------------------------------------------------------
// Typed DB singleton — import { db } from '@/packages/db'
// ---------------------------------------------------------------------------
export const db = {
  vendors: createTableAccessor<VendorRow, VendorInsert>('vendors'),
  customers: createTableAccessor<CustomerRow, CustomerInsert>('customers'),
  invoices: createTableAccessor<InvoiceRow, InvoiceInsert>('invoices'),
  payments: createTableAccessor<PaymentRow, PaymentInsert>('payments'),
  integrations: createTableAccessor<IntegrationRow, IntegrationInsert>('integrations'),
  syncHistory: createTableAccessor<SyncHistoryRow, SyncHistoryInsert>('sync_history'),
  bankAccounts: createTableAccessor<BankAccountRow, BankAccountInsert>('bank_accounts'),
  bankMovements: createTableAccessor<BankMovementRow, BankMovementInsert>('bank_movements'),
  syntageExtractions: createTableAccessor<SyntageExtractionRow, SyntageExtractionInsert>('syntage_extractions'),
};

export type TypedDB = typeof db;
