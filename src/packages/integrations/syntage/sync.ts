/**
 * Syntage SAT Sync Provider
 *
 * Implements BaseSyncProvider for SAT data extraction via Syntage.
 * Creates extractions for invoices, tax status, and compliance checks.
 */
import { BaseSyncProvider, type SyncData, type SyncDiff, type SyncProviderConfig } from '@/packages/sync-engine';
import { getAdminClient } from '@/lib/supabase/admin';
import { ApiError } from '@/lib/utils/errors';
import {
  type Extractor,
  type ExtractionResult,
  createExtraction,
} from '@/lib/integrations/syntage';
import type { SyncProvider as ProviderName, SyncResult } from '@/packages/shared/types';

interface SyntageSyncConfig {
  taxpayerId: string;
  extractors: Extractor[];
  dateFrom?: string;
  dateTo?: string;
}

export interface SatSyncResult extends SyncResult {
  extractions: Array<{
    extractor: Extractor;
    extractionId: string;
    status: string;
  }>;
}

export class SyntageSyncProvider extends BaseSyncProvider<SyntageSyncConfig> {
  readonly name: ProviderName = 'syntage';

  /** The integrations table stores this provider as 'sat', not 'syntage' */
  override get dbProviderName(): string {
    return 'sat';
  }

  private extractionResults: SatSyncResult['extractions'] = [];

  async getConfig(companyId: string): Promise<SyntageSyncConfig> {
    const admin = getAdminClient();
    const { data: integration } = await admin
      .from('integrations')
      .select('syntage_taxpayer_id')
      .eq('company_id', companyId)
      .eq('provider', 'sat')
      .single();

    if (!integration?.syntage_taxpayer_id) {
      throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Syntage no configurado', 422);
    }

    return {
      taxpayerId: integration.syntage_taxpayer_id,
      extractors: ['invoices', 'tax_status', 'tax_compliance_checks'] as Extractor[],
    };
  }

  /**
   * For SAT, "fetch" means creating extractions (async jobs).
   * The actual data arrives via webhooks later.
   */
  async fetch(config: SyntageSyncConfig, _opts: SyncProviderConfig): Promise<SyncData> {
    const extractions: Array<ExtractionResult & { _extractor: Extractor }> = [];
    this.extractionResults = [];

    for (const extractor of config.extractors) {
      try {
        const extraction = await createExtraction(config.taxpayerId, extractor, {
          dateFrom: config.dateFrom,
          dateTo: config.dateTo,
        });
        extractions.push({ ...extraction, _extractor: extractor });
        this.extractionResults.push({
          extractor,
          extractionId: extraction.id,
          status: extraction.status || 'pending',
        });
      } catch (err) {
        this.extractionResults.push({
          extractor,
          extractionId: '',
          status: 'failed',
        });
        // Continue — partial extraction is better than none
        console.error(`[syntage-sync] Error creating ${extractor} extraction:`, err);
      }
    }

    return { extractions };
  }

  transform(remote: SyncData, companyId: string): SyncDiff {
    const extractions = (
      remote.extractions as Array<ExtractionResult & { _extractor: Extractor }>
    )
      .filter((e) => e.id) // Skip failed ones
      .map((e) => ({
        company_id: companyId,
        syntage_extraction_id: e.id,
        extractor: e._extractor,
        status: 'pending',
      }));

    return {
      extractions: {
        rows: extractions,
        onConflict: 'syntage_extraction_id',
        table: 'syntage_extractions',
      },
    };
  }

  /** Get extraction results for the last run */
  getExtractionResults(): SatSyncResult['extractions'] {
    return this.extractionResults;
  }
}
