/**
 * Odoo Sync Provider Tests — invoices only.
 */
import { describe, it, expect, vi } from 'vitest';
import { OdooSyncProvider } from '../odoo/sync';
import type { SyncData } from '@/packages/sync-engine';

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
    }),
  }),
}));

vi.mock('@/lib/utils/crypto', () => ({
  decrypt: () => ({ url: 'https://odoo.test', db: 'test', uid: 1, apiKey: 'key' }),
}));

vi.mock('@/lib/utils/errors', () => ({
  ApiError: class ApiError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
}));

vi.mock('@/lib/integrations/odoo', () => ({
  fetchOdooInvoices: vi.fn(),
  normalizeOdooValue: <T>(v: T | false): T | null => (v === false ? null : v),
  extractM2oName: (field: [number, string] | false): string | null =>
    field === false || !field ? null : field[1],
}));

describe('OdooSyncProvider', () => {
  const provider = new OdooSyncProvider();

  it('has name "odoo"', () => {
    expect(provider.name).toBe('odoo');
  });

  describe('transform', () => {
    it('transforms invoices with correct field mapping', () => {
      const remote: SyncData = {
        invoices: [
          {
            id: 100,
            name: 'INV/2026/001',
            move_type: 'out_invoice',
            partner_id: [42, 'Acme SA'],
            invoice_date: '2026-03-01',
            invoice_date_due: '2026-03-15',
            amount_total: 125000,
            amount_residual: 50000,
            amount_tax: 20000,
            payment_state: 'partial',
            l10n_mx_edi_cfdi_uuid: 'UUID-12345',
            l10n_mx_edi_payment_policy: 'PPD',
          },
        ],
      };

      const diff = provider.transform(remote, '1');
      expect(Object.keys(diff)).toEqual(['invoices']);
      expect(diff.invoices.rows).toHaveLength(1);
      expect(diff.invoices.table).toBe('invoices');
      expect(diff.invoices.onConflict).toBe('company_id,odoo_id');

      const invoice = diff.invoices.rows[0] as Record<string, unknown>;
      expect(invoice.company_id).toBe(1);
      expect(invoice.invoice_number).toBe('INV/2026/001');
      expect(invoice.type).toBe('receivable');
      expect(invoice.move_type).toBe('out_invoice');
      expect(invoice.amount_total).toBe(125000);
      expect(invoice.amount_residual).toBe(50000);
      expect(invoice.amount_paid).toBe(75000); // 125000 - 50000
      expect(invoice.partner_name).toBe('Acme SA');
      expect(invoice.odoo_id).toBe(100);
      expect(invoice.odoo_move_id).toBe('100');
      expect(invoice.source).toBe('odoo');
      expect(invoice.uuid).toBe('UUID-12345');
    });

    it('handles empty remote data', () => {
      const diff = provider.transform({ invoices: [] }, '1');
      expect(diff.invoices.rows).toHaveLength(0);
    });
  });
});
