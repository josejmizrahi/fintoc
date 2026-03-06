/**
 * Fintoc Sync Provider Tests
 */
import { describe, it, expect, vi } from 'vitest';
import { FintocSyncProvider } from '../fintoc/sync';
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
  decrypt: () => ({ secret_key: 'sk_test_123' }),
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

vi.mock('@/lib/integrations/fintoc', () => ({
  getAccounts: vi.fn(),
  getAllMovements: vi.fn(),
  centavosToPesos: (centavos: number) => Math.round(centavos) / 100,
}));

describe('FintocSyncProvider', () => {
  const provider = new FintocSyncProvider();

  it('has name "fintoc"', () => {
    expect(provider.name).toBe('fintoc');
  });

  describe('transform', () => {
    it('transforms accounts correctly', () => {
      const remote: SyncData = {
        accounts: [
          {
            id: 'acc_123',
            name: 'Cuenta BBVA',
            number: '012345678901234567',
            holder_name: 'Empresa SA',
            currency: 'MXN',
            balance: { available: 15000000, current: 15000000 },
          },
        ],
        movements: [],
      };

      const diff = provider.transform(remote, 'company-1');
      expect(diff.accounts.table).toBe('bank_accounts');
      expect(diff.accounts.onConflict).toBe('fintoc_account_id');
      expect(diff.accounts.rows).toHaveLength(1);

      const account = diff.accounts.rows[0] as Record<string, unknown>;
      expect(account.company_id).toBe('company-1');
      expect(account.fintoc_account_id).toBe('acc_123');
      expect(account.clabe).toBe('012345678901234567');
      expect(account.bank_name).toBe('Cuenta BBVA');
      expect(account.balance).toBe(150000); // centavos to pesos
    });

    it('transforms movements with sender/recipient names', () => {
      const remote: SyncData = {
        accounts: [],
        movements: [
          {
            id: 'mov_456',
            _accountId: 'acc_123',
            amount: 5000000,
            post_date: '2026-03-01',
            description: 'SPEI recibido',
            type: 'credit',
            reference_id: 'REF-001',
            sender_account: { holder_name: 'Acme SA' },
            recipient_account: { holder_name: 'Mi Empresa' },
          },
          {
            id: 'mov_789',
            _accountId: 'acc_123',
            amount: 2000000,
            post_date: '2026-03-02',
            description: 'Pago a proveedor',
            type: 'debit',
            reference_id: null,
            sender_account: null,
            recipient_account: { holder_name: 'Proveedor X' },
          },
        ],
      };

      const diff = provider.transform(remote, 'company-1');
      expect(diff.movements.table).toBe('bank_movements');
      expect(diff.movements.onConflict).toBe('fintoc_movement_id');
      expect(diff.movements.rows).toHaveLength(2);

      const mov1 = diff.movements.rows[0] as Record<string, unknown>;
      expect(mov1.fintoc_movement_id).toBe('mov_456');
      expect(mov1.amount).toBe(50000); // centavos to pesos
      expect(mov1.type).toBe('credit');
      expect(mov1.sender_name).toBe('Acme SA');

      const mov2 = diff.movements.rows[1] as Record<string, unknown>;
      expect(mov2.type).toBe('debit');
      expect(mov2.recipient_name).toBe('Proveedor X');
    });

    it('handles accounts with null balance', () => {
      const remote: SyncData = {
        accounts: [
          {
            id: 'acc_empty',
            name: 'Cuenta sin saldo',
            number: '987654321098765432',
            holder_name: null,
            currency: 'MXN',
            balance: { available: null, current: null },
          },
        ],
        movements: [],
      };

      const diff = provider.transform(remote, 'company-1');
      const account = diff.accounts.rows[0] as Record<string, unknown>;
      expect(account.balance).toBeNull();
      expect(account.account_holder).toBeNull();
    });
  });
});
