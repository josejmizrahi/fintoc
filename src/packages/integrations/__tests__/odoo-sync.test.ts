/**
 * Odoo Sync Provider Tests
 *
 * Tests the OdooSyncProvider transform logic without real API calls.
 */
import { describe, it, expect, vi } from 'vitest';
import { OdooSyncProvider } from '../odoo/sync';
import type { SyncData } from '@/packages/sync-engine';

// Mock all external dependencies
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
  fetchOdooVendors: vi.fn(),
  fetchOdooCustomers: vi.fn(),
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
    it('merges new vendors correctly', () => {
      const remote: SyncData = {
        vendors: [
          { id: 1, name: 'Acme SA', vat: 'ACM010101AAA', email: 'acme@test.mx', phone: '5512345678' },
          { id: 2, name: 'Beta Corp', vat: 'BET020202BBB', email: false, phone: false },
        ],
        customers: [],
        invoices: [],
      };

      const diff = provider.transform(remote, '1');

      // Vendors
      expect(diff.vendors.rows).toHaveLength(2);
      expect(diff.vendors.table).toBe('vendors');
      expect(diff.vendors.onConflict).toBe('company_id,rfc');

      const vendor1 = diff.vendors.rows[0] as Record<string, unknown>;
      expect(vendor1.company_id).toBe(1);
      expect(vendor1.name).toBe('Acme SA');
      expect(vendor1.rfc).toBe('ACM010101AAA');
      expect(vendor1.email).toBe('acme@test.mx');

      const vendor2 = diff.vendors.rows[1] as Record<string, unknown>;
      expect(vendor2.email).toBeNull();
    });

    it('filters out vendors without RFC', () => {
      const remote: SyncData = {
        vendors: [
          { id: 1, name: 'Has RFC', vat: 'ABC010101AAA', email: false, phone: false },
          { id: 2, name: 'No RFC', vat: false, email: false, phone: false },
          { id: 3, name: 'Empty RFC', vat: '', email: false, phone: false },
        ],
        customers: [],
        invoices: [],
      };

      const diff = provider.transform(remote, '1');
      expect(diff.vendors.rows).toHaveLength(1);
      expect((diff.vendors.rows[0] as Record<string, unknown>).name).toBe('Has RFC');
    });

    it('transforms invoices with correct field mapping', () => {
      const remote: SyncData = {
        vendors: [],
        customers: [],
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
      expect(diff.invoices.rows).toHaveLength(1);
      expect(diff.invoices.table).toBe('invoices');
      expect(diff.invoices.onConflict).toBe('company_id,odoo_id');

      const invoice = diff.invoices.rows[0] as Record<string, unknown>;
      expect(invoice.company_id).toBe(1);
      expect(invoice.invoice_number).toBe('INV/2026/001');
      expect(invoice.type).toBe('out_invoice');
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
      const diff = provider.transform(
        { vendors: [], customers: [], invoices: [] },
        '1',
      );
      expect(diff.vendors.rows).toHaveLength(0);
      expect(diff.customers.rows).toHaveLength(0);
      expect(diff.invoices.rows).toHaveLength(0);
    });
  });
});
