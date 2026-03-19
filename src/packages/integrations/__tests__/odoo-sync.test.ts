/**
 * Odoo Sync Provider Tests — full sync: invoices, vendors, customers, payments, expenses, purchase orders.
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

vi.mock('@/lib/retry', () => ({
  withRetry: (fn: () => Promise<unknown>) => fn(),
  isRetryableError: () => false,
}));

vi.mock('@/lib/integrations/odoo', () => ({
  fetchOdooInvoices: vi.fn(),
  fetchOdooVendors: vi.fn(),
  fetchOdooCustomers: vi.fn(),
  fetchOdooPayments: vi.fn(),
  fetchOdooExpenses: vi.fn(),
  fetchOdooPurchaseOrders: vi.fn(),
  normalizeOdooValue: <T>(v: T | false): T | null => (v === false ? null : v),
  extractM2oName: (field: [number, string] | false): string | null =>
    field === false || !field ? null : field[1],
  extractM2oId: (field: [number, string] | false): number | null =>
    field === false || !field ? null : field[0],
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
            amount_untaxed: 105000,
            currency_id: [33, 'MXN'],
            state: 'posted',
            payment_state: 'partial',
            l10n_mx_edi_cfdi_uuid: 'UUID-12345',
            l10n_mx_edi_payment_policy: 'PPD',
            l10n_mx_edi_usage: 'G03',
            ref: false,
            narration: false,
            write_date: '2026-03-01 00:00:00',
          },
        ],
        vendors: [],
        customers: [],
        payments: [],
        expenses: [],
        purchaseOrders: [],
      };

      const diff = provider.transform(remote, '1');
      expect(Object.keys(diff)).toContain('invoices');
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
      expect(invoice.amount_paid).toBe(75000);
      expect(invoice.partner_name).toBe('Acme SA');
      expect(invoice.odoo_id).toBe(100);
      expect(invoice.odoo_move_id).toBe('100');
      expect(invoice.odoo_cfdi_uuid).toBe('UUID-12345');
      expect(invoice.odoo_usage).toBe('G03');
      expect(invoice.currency).toBe('MXN');
      expect(invoice.source).toBe('odoo');
      expect(invoice.uuid).toBe('UUID-12345');
    });

    it('transforms vendors deduplicating by RFC', () => {
      const remote: SyncData = {
        invoices: [],
        vendors: [
          {
            id: 10,
            name: 'Proveedor A',
            vat: 'AAA010101AAA',
            email: 'a@test.com',
            phone: '5551234567',
            bank_ids: [],
            active: true,
            supplier_rank: 2,
            write_date: '2026-03-01 00:00:00',
          },
          {
            id: 11,
            name: 'Proveedor A Duplicado',
            vat: 'AAA010101AAA', // Same RFC
            email: 'a2@test.com',
            phone: false,
            bank_ids: [],
            active: true,
            supplier_rank: 1,
            write_date: '2026-03-02 00:00:00',
          },
        ],
        customers: [],
        payments: [],
        expenses: [],
        purchaseOrders: [],
      };

      const diff = provider.transform(remote, '1');
      expect(diff.vendors.rows).toHaveLength(1);
      expect(diff.vendors.table).toBe('vendors');
      expect(diff.vendors.onConflict).toBe('company_id,rfc');

      const vendor = diff.vendors.rows[0] as Record<string, unknown>;
      // Last one wins due to Map dedup
      expect(vendor.rfc).toBe('AAA010101AAA');
      expect(vendor.source).toBe('odoo');
    });

    it('transforms customers filtering out those without RFC', () => {
      const remote: SyncData = {
        invoices: [],
        vendors: [],
        customers: [
          {
            id: 20,
            name: 'Cliente Con RFC',
            vat: 'BBB020202BBB',
            email: 'b@test.com',
            phone: false,
            active: true,
            customer_rank: 1,
            write_date: '2026-03-01 00:00:00',
          },
          {
            id: 21,
            name: 'Cliente Sin RFC',
            vat: false,
            email: 'c@test.com',
            phone: false,
            active: true,
            customer_rank: 1,
            write_date: '2026-03-01 00:00:00',
          },
        ],
        payments: [],
        expenses: [],
        purchaseOrders: [],
      };

      const diff = provider.transform(remote, '1');
      expect(diff.customers.rows).toHaveLength(1);
      expect((diff.customers.rows[0] as Record<string, unknown>).rfc).toBe('BBB020202BBB');
    });

    it('transforms payments with correct direction mapping', () => {
      const remote: SyncData = {
        invoices: [],
        vendors: [],
        customers: [],
        payments: [
          {
            id: 50,
            name: 'PAGO/2026/001',
            payment_type: 'outbound',
            partner_type: 'supplier',
            partner_id: [42, 'Proveedor X'],
            amount: 50000,
            currency_id: [33, 'MXN'],
            journal_id: [1, 'Banco'],
            date: '2026-03-01',
            ref: 'REF-001',
            state: 'posted',
            reconciled_invoice_ids: [100, 101],
            move_id: [200, 'PAGO/2026/001'],
            write_date: '2026-03-01 00:00:00',
          },
          {
            id: 51,
            name: 'COBRO/2026/001',
            payment_type: 'inbound',
            partner_type: 'customer',
            partner_id: [43, 'Cliente Y'],
            amount: 30000,
            currency_id: [33, 'MXN'],
            journal_id: [1, 'Banco'],
            date: '2026-03-02',
            ref: false,
            state: 'reconciled',
            reconciled_invoice_ids: [],
            move_id: [201, 'COBRO/2026/001'],
            write_date: '2026-03-02 00:00:00',
          },
        ],
        expenses: [],
        purchaseOrders: [],
      };

      const diff = provider.transform(remote, '1');
      expect(diff.payments.rows).toHaveLength(2);
      expect(diff.payments.table).toBe('payments');
      expect(diff.payments.onConflict).toBe('company_id,odoo_id');

      const outbound = diff.payments.rows[0] as Record<string, unknown>;
      expect(outbound.direction).toBe('outbound');
      expect(outbound.status).toBe('confirmed');
      expect(outbound.amount).toBe(50000);
      expect(outbound.partner_name).toBe('Proveedor X');
      expect(outbound.odoo_state).toBe('posted');
      expect(outbound.reference_id).toBe('REF-001');
      expect(outbound.source).toBe('odoo');

      const inbound = diff.payments.rows[1] as Record<string, unknown>;
      expect(inbound.direction).toBe('inbound');
      expect(inbound.status).toBe('confirmed');
      expect(inbound.partner_name).toBe('Cliente Y');
    });

    it('transforms expenses with correct state mapping', () => {
      const remote: SyncData = {
        invoices: [],
        vendors: [],
        customers: [],
        payments: [],
        expenses: [
          {
            id: 70,
            name: 'Viáticos CDMX',
            employee_id: [5, 'Juan Pérez'],
            product_id: [10, 'Viáticos'],
            total_amount: 3500,
            currency_id: [33, 'MXN'],
            date: '2026-03-01',
            description: 'Viaje de negocios a CDMX',
            reference: 'EXP-001',
            state: 'approved',
            payment_mode: 'company_account',
            sheet_id: [3, 'Hoja de Gastos Marzo'],
            write_date: '2026-03-01 00:00:00',
          },
        ],
        purchaseOrders: [],
      };

      const diff = provider.transform(remote, '1');
      expect(diff.expenses.rows).toHaveLength(1);
      expect(diff.expenses.table).toBe('expenses');

      const expense = diff.expenses.rows[0] as Record<string, unknown>;
      expect(expense.employee_name).toBe('Juan Pérez');
      expect(expense.category).toBe('Viáticos');
      expect(expense.amount).toBe(3500);
      expect(expense.status).toBe('approved');
      expect(expense.payment_mode).toBe('company_account');
      expect(expense.sheet_id).toBe(3);
      expect(expense.expense_reference).toBe('EXP-001');
      expect(expense.source).toBe('odoo');
    });

    it('transforms purchase orders', () => {
      const remote: SyncData = {
        invoices: [],
        vendors: [],
        customers: [],
        payments: [],
        expenses: [],
        purchaseOrders: [
          {
            id: 90,
            name: 'PO/2026/001',
            partner_id: [42, 'Proveedor X'],
            state: 'purchase',
            amount_total: 100000,
            amount_tax: 16000,
            currency_id: [33, 'MXN'],
            date_order: '2026-03-01 10:00:00',
            date_planned: '2026-03-15 10:00:00',
            invoice_status: 'to invoice',
            invoice_count: 0,
            notes: 'Pedido urgente',
            write_date: '2026-03-01 00:00:00',
          },
        ],
      };

      const diff = provider.transform(remote, '1');
      expect(diff.purchaseOrders.rows).toHaveLength(1);
      expect(diff.purchaseOrders.table).toBe('odoo_purchase_orders');

      const po = diff.purchaseOrders.rows[0] as Record<string, unknown>;
      expect(po.company_id).toBe(1);
      expect(po.odoo_id).toBe(90);
      expect(po.name).toBe('PO/2026/001');
      expect(po.partner_name).toBe('Proveedor X');
      expect(po.partner_id).toBe(42);
      expect(po.state).toBe('purchase');
      expect(po.amount_total).toBe(100000);
      expect(po.invoice_status).toBe('to invoice');
      expect(po.source).toBe('odoo');
    });

    it('handles empty remote data for all entities', () => {
      const diff = provider.transform({
        invoices: [],
        vendors: [],
        customers: [],
        payments: [],
        expenses: [],
        purchaseOrders: [],
      }, '1');

      expect(diff.invoices.rows).toHaveLength(0);
      expect(diff.vendors.rows).toHaveLength(0);
      expect(diff.customers.rows).toHaveLength(0);
      expect(diff.payments.rows).toHaveLength(0);
      expect(diff.expenses.rows).toHaveLength(0);
      expect(diff.purchaseOrders.rows).toHaveLength(0);
    });

    it('returns all 6 entity types in diff', () => {
      const diff = provider.transform({
        invoices: [],
        vendors: [],
        customers: [],
        payments: [],
        expenses: [],
        purchaseOrders: [],
      }, '1');

      expect(Object.keys(diff).sort()).toEqual([
        'customers', 'expenses', 'invoices', 'payments', 'purchaseOrders', 'vendors',
      ]);
    });

    it('marks vendors and customers with skipUpsert for smart linking', () => {
      const diff = provider.transform({
        invoices: [],
        vendors: [
          { id: 1, name: 'V', vat: 'ABC', email: false, phone: false, bank_ids: [], active: true, supplier_rank: 1, write_date: '' },
        ],
        customers: [
          { id: 2, name: 'C', vat: 'DEF', email: false, phone: false, active: true, customer_rank: 1, write_date: '' },
        ],
        payments: [],
        expenses: [],
        purchaseOrders: [],
      }, '1');

      expect(diff.vendors.skipUpsert).toBe(true);
      expect(diff.customers.skipUpsert).toBe(true);
      expect(diff.invoices.skipUpsert).toBeUndefined();
      expect(diff.payments.skipUpsert).toBeUndefined();
    });
  });
});
