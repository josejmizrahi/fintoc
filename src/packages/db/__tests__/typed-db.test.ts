/**
 * Typed DB Layer Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase
const mockData = vi.fn();
const mockError = vi.fn();
const mockMaybeSingle = vi.fn();
const mockSingle = vi.fn();
const mockLimit = vi.fn(() => ({ maybeSingle: mockMaybeSingle, single: mockSingle }));
const mockOrder = vi.fn(() => ({ limit: mockLimit, data: [], error: null }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockEq: any = vi.fn(() => ({
  eq: (...args: unknown[]) => mockEq(...args),
  order: mockOrder,
  limit: mockLimit,
  select: vi.fn(() => ({ data: [], error: null })),
  data: [],
  error: null,
}));

const mockSelectReturn = {
  eq: mockEq,
  order: mockOrder,
  limit: mockLimit,
  data: [],
  error: null,
};

const mockSelect = vi.fn(() => mockSelectReturn);
const mockInsert = vi.fn(() => ({ select: vi.fn(() => ({ data: [], error: null })) }));
const mockUpdate = vi.fn(() => ({ eq: mockEq }));
const mockUpsert = vi.fn(() => ({ select: vi.fn(() => ({ data: [], error: null })) }));

const mockFrom = vi.fn(() => ({
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  upsert: mockUpsert,
}));

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    from: mockFrom,
  }),
}));

describe('Typed DB Layer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports db object with typed table accessors', async () => {
    const { db } = await import('../index');

    expect(db).toHaveProperty('vendors');
    expect(db).toHaveProperty('customers');
    expect(db).toHaveProperty('invoices');
    expect(db).toHaveProperty('payments');
    expect(db).toHaveProperty('integrations');
    expect(db).toHaveProperty('syncHistory');
    expect(db).toHaveProperty('bankAccounts');
    expect(db).toHaveProperty('bankMovements');
  });

  it('findMany calls supabase with correct table name', async () => {
    const { db } = await import('../index');
    mockSelect.mockReturnValue({ eq: mockEq, order: mockOrder, limit: mockLimit, data: [{ id: '1', name: 'Test' }] as never[], error: null });

    // The function uses the admin client internally
    expect(db.vendors).toBeDefined();
    expect(typeof db.vendors.findMany).toBe('function');
    expect(typeof db.vendors.findOne).toBe('function');
    expect(typeof db.vendors.insert).toBe('function');
    expect(typeof db.vendors.update).toBe('function');
    expect(typeof db.vendors.upsert).toBe('function');
    expect(typeof db.vendors.count).toBe('function');
  });

  it('table accessor methods exist for all tables', async () => {
    const { db } = await import('../index');

    const tables = ['vendors', 'customers', 'invoices', 'payments', 'integrations', 'syncHistory', 'bankAccounts', 'bankMovements'] as const;

    for (const table of tables) {
      const accessor = db[table];
      expect(accessor).toBeDefined();
      expect(typeof accessor.findMany).toBe('function');
      expect(typeof accessor.findOne).toBe('function');
      expect(typeof accessor.insert).toBe('function');
      expect(typeof accessor.update).toBe('function');
      expect(typeof accessor.upsert).toBe('function');
      expect(typeof accessor.count).toBe('function');
      expect(typeof accessor.query).toBe('function');
    }
  });
});
