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
      };

      const diff = provider.transform(remote, 'company-1');
      expect(diff.accounts.table).toBe('bank_accounts');
      expect(diff.accounts.onConflict).toBe('fintoc_account_id');
      expect(diff.accounts.rows).toHaveLength(1);
      expect(Object.keys(diff)).toEqual(['accounts']);

      const account = diff.accounts.rows[0] as Record<string, unknown>;
      expect(account.company_id).toBe('company-1');
      expect(account.fintoc_account_id).toBe('acc_123');
      expect(account.clabe).toBe('012345678901234567');
      expect(account.bank_name).toBe('Cuenta BBVA');
      expect(account.balance).toBe(150000); // centavos to pesos
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
      };

      const diff = provider.transform(remote, 'company-1');
      const account = diff.accounts.rows[0] as Record<string, unknown>;
      expect(account.balance).toBeNull();
      expect(account.account_holder).toBeNull();
    });
  });
});
