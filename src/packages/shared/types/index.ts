// Re-export database types
export type { Database } from '@/types/database';

// Common domain types used across packages
export type SyncProvider = 'odoo' | 'fintoc' | 'syntage';
export type SyncStatus = 'running' | 'completed' | 'partial' | 'failed';
export type IntegrationStatus = 'pending' | 'connected' | 'error';

export interface SyncResult {
  provider: SyncProvider;
  status: SyncStatus;
  recordsSynced: number;
  recordsFailed: number;
  errors: SyncError[];
  startedAt: string;
  completedAt: string;
  details: Record<string, number>;
}

export interface SyncError {
  entity: string;
  entityId?: string;
  message: string;
  retryable: boolean;
}

/** Integration row with separated settings vs credentials */
export interface IntegrationConfig {
  companyId: string;
  provider: SyncProvider;
  status: IntegrationStatus;
  /** Public config — safe for UI to read */
  settings: Record<string, unknown>;
  /** Encrypted secrets — server-only */
  credentials: Record<string, unknown>;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
}
