/**
 * Sync Engine Tests
 *
 * Tests the abstract SyncProvider pattern with a mock provider.
 * No real API calls — everything is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseSyncProvider, type SyncData, type SyncDiff, type SyncProviderConfig } from '../index';

// ---------------------------------------------------------------------------
// Mock Supabase
// ---------------------------------------------------------------------------
const mockSingle = vi.fn();
const mockSelect = vi.fn(() => ({ single: mockSingle, limit: vi.fn(() => ({ single: mockSingle, maybeSingle: mockSingle })) }));
const mockEq = vi.fn(() => ({ eq: mockEq, select: mockSelect, order: vi.fn(() => ({ limit: vi.fn(() => ({ single: mockSingle })) })), single: mockSingle, limit: vi.fn(() => ({ single: mockSingle })) }));
const mockUpdate = vi.fn(() => ({ eq: mockEq }));
const mockInsert = vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn() })) }));
const mockUpsert = vi.fn(() => ({ error: null }));
const mockFrom = vi.fn(() => ({
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  upsert: mockUpsert,
  eq: mockEq,
}));

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    from: mockFrom,
  }),
}));

vi.mock('@/lib/retry', () => ({
  withRetry: async <T>(fn: () => Promise<T>) => fn(),
  isRetryableError: () => true,
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

// ---------------------------------------------------------------------------
// Mock SyncProvider for testing
// ---------------------------------------------------------------------------
interface MockConfig {
  apiUrl: string;
}

class MockSyncProvider extends BaseSyncProvider<MockConfig> {
  readonly name = 'odoo' as const;

  fetchCallCount = 0;
  transformCallCount = 0;

  async getConfig(_companyId: string): Promise<MockConfig> {
    return { apiUrl: 'https://mock.odoo.com' };
  }

  async fetch(_config: MockConfig, _opts: SyncProviderConfig): Promise<SyncData> {
    this.fetchCallCount++;
    return {
      vendors: [
        { id: 1, name: 'Acme Corp', vat: 'ACM010101AAA', email: 'info@acme.mx', phone: false },
        { id: 2, name: 'Beta Inc', vat: 'BET020202BBB', email: 'info@beta.mx', phone: '5512345678' },
        { id: 3, name: 'No RFC Corp', vat: false, email: 'norfc@test.mx', phone: false },
      ],
    };
  }

  transform(remote: SyncData, companyId: string): SyncDiff {
    this.transformCallCount++;

    const vendors = (remote.vendors as Array<{ id: number; name: string; vat: string | false; email: string | false }>)
      .filter((v) => v.vat && String(v.vat).length > 0)
      .map((v) => ({
        company_id: companyId,
        name: v.name,
        rfc: String(v.vat).toUpperCase(),
        email: v.email === false ? null : v.email,
        odoo_id: String(v.id),
        synced_at: new Date().toISOString(),
      }));

    return {
      vendors: {
        rows: vendors,
        onConflict: 'company_id,rfc',
        table: 'vendors',
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('BaseSyncProvider', () => {
  let provider: MockSyncProvider;

  beforeEach(() => {
    provider = new MockSyncProvider();
    vi.clearAllMocks();

    // Default: no running sync (no lock conflict)
    mockSingle.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
    // Insert sync_history entry
    mockInsert.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: { id: 'sync-123' }, error: null }),
      })),
    });
    // Upsert succeeds
    mockUpsert.mockResolvedValue({ error: null });
  });

  it('has the correct provider name', () => {
    expect(provider.name).toBe('odoo');
  });

  it('getConfig returns mock config', async () => {
    const config = await provider.getConfig('company-1');
    expect(config.apiUrl).toBe('https://mock.odoo.com');
  });

  it('fetch returns remote data', async () => {
    const data = await provider.fetch({ apiUrl: 'https://mock.odoo.com' }, { companyId: '1' });
    expect(data.vendors).toHaveLength(3);
    expect(provider.fetchCallCount).toBe(1);
  });

  it('transform filters vendors without RFC', () => {
    const remote: SyncData = {
      vendors: [
        { id: 1, name: 'Acme', vat: 'ACM010101AAA', email: 'a@a.mx' },
        { id: 2, name: 'NoRFC', vat: false, email: 'b@b.mx' },
      ],
    };

    const diff = provider.transform(remote, 'company-1');
    expect(diff.vendors.rows).toHaveLength(1);
    expect((diff.vendors.rows[0] as Record<string, unknown>).rfc).toBe('ACM010101AAA');
    expect(diff.vendors.onConflict).toBe('company_id,rfc');
    expect(diff.vendors.table).toBe('vendors');
    expect(provider.transformCallCount).toBe(1);
  });

  it('transform sets company_id on all rows', () => {
    const remote: SyncData = {
      vendors: [
        { id: 1, name: 'Acme', vat: 'ACM010101AAA', email: 'a@a.mx' },
      ],
    };

    const diff = provider.transform(remote, 'company-42');
    expect((diff.vendors.rows[0] as Record<string, unknown>).company_id).toBe('company-42');
  });

  it('transform handles empty data', () => {
    const diff = provider.transform({ vendors: [] }, 'company-1');
    expect(diff.vendors.rows).toHaveLength(0);
  });
});

describe('OdooSync transform logic', () => {
  it('uppercases RFC values', () => {
    const provider = new MockSyncProvider();
    const remote: SyncData = {
      vendors: [
        { id: 1, name: 'Test', vat: 'abc010101aaa', email: false },
      ],
    };
    const diff = provider.transform(remote, '1');
    expect((diff.vendors.rows[0] as Record<string, unknown>).rfc).toBe('ABC010101AAA');
  });

  it('converts false emails to null', () => {
    const provider = new MockSyncProvider();
    const remote: SyncData = {
      vendors: [
        { id: 1, name: 'Test', vat: 'ABC010101AAA', email: false },
      ],
    };
    const diff = provider.transform(remote, '1');
    expect((diff.vendors.rows[0] as Record<string, unknown>).email).toBeNull();
  });

  it('preserves valid email strings', () => {
    const provider = new MockSyncProvider();
    const remote: SyncData = {
      vendors: [
        { id: 1, name: 'Test', vat: 'ABC010101AAA', email: 'test@example.com' },
      ],
    };
    const diff = provider.transform(remote, '1');
    expect((diff.vendors.rows[0] as Record<string, unknown>).email).toBe('test@example.com');
  });
});

describe('SyncDiff structure', () => {
  it('groups entities by table with correct conflict keys', () => {
    const provider = new MockSyncProvider();
    const remote: SyncData = {
      vendors: [
        { id: 1, name: 'V1', vat: 'V01010101AAA', email: 'v1@test.mx' },
        { id: 2, name: 'V2', vat: 'V02020202BBB', email: 'v2@test.mx' },
      ],
    };

    const diff = provider.transform(remote, 'company-1');

    // Should have vendors entity
    expect(diff).toHaveProperty('vendors');
    expect(diff.vendors.table).toBe('vendors');
    expect(diff.vendors.onConflict).toBe('company_id,rfc');
    expect(diff.vendors.rows).toHaveLength(2);
  });
});
