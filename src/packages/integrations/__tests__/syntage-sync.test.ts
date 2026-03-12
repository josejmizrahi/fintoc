import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyntageSyncProvider } from '../syntage/sync';
import type { SyncData, SyncProviderConfig } from '@/packages/sync-engine';

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: { syntage_taxpayer_id: 'TAX123' }, error: null }),
          }),
        }),
      }),
    }),
  }),
}));

vi.mock('@/lib/utils/errors', () => ({
  ApiError: class ApiError extends Error {
    code: string; status: number;
    constructor(code: string, message: string, status: number) { super(message); this.code = code; this.status = status; }
  },
}));

vi.mock('@/lib/integrations/syntage', () => ({
  createExtraction: vi.fn(),
}));

import { createExtraction, type Extractor } from '@/lib/integrations/syntage';

const mockCreateExtraction = vi.mocked(createExtraction);

const mockOpts: SyncProviderConfig = { companyId: 'company-abc' };

describe('SyntageSyncProvider', () => {
  let provider: SyntageSyncProvider;

  beforeEach(() => {
    provider = new SyntageSyncProvider();
    vi.clearAllMocks();
  });

  describe('provider identity', () => {
    it('has name "syntage"', () => {
      expect(provider.name).toBe('syntage');
    });

    it('has dbProviderName "sat"', () => {
      expect(provider.dbProviderName).toBe('sat');
    });
  });

  describe('transform()', () => {
    it('maps extractions with correct shape and company_id', () => {
      const remote: SyncData = {
        extractions: [
          { id: 'ext-1', _extractor: 'invoices', status: 'pending' },
          { id: 'ext-2', _extractor: 'tax_status', status: 'completed' },
        ],
      };

      const diff = provider.transform(remote, 'company-abc');

      expect(diff.extractions.rows).toHaveLength(2);
      expect(diff.extractions.rows[0]).toEqual({
        company_id: 'company-abc',
        syntage_extraction_id: 'ext-1',
        extractor: 'invoices',
        status: 'pending',
      });
      expect(diff.extractions.rows[1]).toEqual({
        company_id: 'company-abc',
        syntage_extraction_id: 'ext-2',
        extractor: 'tax_status',
        status: 'pending',
      });
      expect(diff.extractions.onConflict).toBe('syntage_extraction_id');
      expect(diff.extractions.table).toBe('syntage_extractions');
    });

    it('filters out extractions without an id', () => {
      const remote: SyncData = {
        extractions: [
          { id: 'ext-1', _extractor: 'invoices', status: 'pending' },
          { id: '', _extractor: 'tax_compliance_checks', status: 'failed' },
          { id: undefined, _extractor: 'tax_status', status: 'failed' },
        ],
      };

      const diff = provider.transform(remote, 'company-abc');

      expect(diff.extractions.rows).toHaveLength(1);
      expect((diff.extractions.rows[0] as Record<string, unknown>).syntage_extraction_id).toBe('ext-1');
    });

    it('handles empty extractions array', () => {
      const remote: SyncData = { extractions: [] };

      const diff = provider.transform(remote, 'company-abc');

      expect(diff.extractions.rows).toHaveLength(0);
      expect(diff.extractions.onConflict).toBe('syntage_extraction_id');
      expect(diff.extractions.table).toBe('syntage_extractions');
    });
  });

  describe('getExtractionResults()', () => {
    it('returns empty array before fetch is called', () => {
      expect(provider.getExtractionResults()).toEqual([]);
    });

    it('returns extraction results populated during fetch()', async () => {
      mockCreateExtraction
        .mockResolvedValueOnce({ id: 'ext-1', status: 'pending', extractor: 'invoices' })
        .mockResolvedValueOnce({ id: 'ext-2', status: 'pending', extractor: 'tax_status' })
        .mockResolvedValueOnce({ id: 'ext-3', status: 'pending', extractor: 'tax_compliance_checks' });

      const config = {
        taxpayerId: 'TAX123',
        extractors: ['invoices', 'tax_status', 'tax_compliance_checks'] as Extractor[],
      };

      await provider.fetch(config, mockOpts);

      const results = provider.getExtractionResults();
      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ extractor: 'invoices', extractionId: 'ext-1', status: 'pending' });
      expect(results[1]).toEqual({ extractor: 'tax_status', extractionId: 'ext-2', status: 'pending' });
      expect(results[2]).toEqual({ extractor: 'tax_compliance_checks', extractionId: 'ext-3', status: 'pending' });
    });
  });

  describe('fetch()', () => {
    it('handles partial failures — failed extractors recorded with empty extractionId', async () => {
      mockCreateExtraction
        .mockResolvedValueOnce({ id: 'ext-1', status: 'pending', extractor: 'invoices' })
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ id: 'ext-3', status: 'pending', extractor: 'tax_compliance_checks' });

      const config = {
        taxpayerId: 'TAX123',
        extractors: ['invoices', 'tax_status', 'tax_compliance_checks'] as Extractor[],
      };

      const data = await provider.fetch(config, mockOpts);
      const results = provider.getExtractionResults();

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ extractor: 'invoices', extractionId: 'ext-1', status: 'pending' });
      expect(results[1]).toEqual({ extractor: 'tax_status', extractionId: '', status: 'failed' });
      expect(results[2]).toEqual({ extractor: 'tax_compliance_checks', extractionId: 'ext-3', status: 'pending' });

      // The returned SyncData should only contain successful extractions
      const extractions = data.extractions as Array<{ id: string; _extractor: string }>;
      expect(extractions).toHaveLength(2);
      expect(extractions[0].id).toBe('ext-1');
      expect(extractions[1].id).toBe('ext-3');
    });

    it('resets extraction results on each fetch call', async () => {
      mockCreateExtraction.mockResolvedValue({ id: 'ext-1', status: 'pending', extractor: 'invoices' });

      const config = {
        taxpayerId: 'TAX123',
        extractors: ['invoices'] as Extractor[],
      };

      await provider.fetch(config, mockOpts);
      await provider.fetch(config, mockOpts);

      // Should reflect only the second fetch, not accumulate
      expect(provider.getExtractionResults()).toHaveLength(1);
    });
  });
});
