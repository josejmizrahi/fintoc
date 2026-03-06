/**
 * Integration Registry
 *
 * Registers all sync providers on import. Use:
 *   import '@/packages/integrations';       // side-effect: registers all providers
 *   import { getProvider } from '@/packages/sync-engine';
 *   const result = await getProvider('odoo').run(companyId);
 */
import { registerProvider } from '@/packages/sync-engine';
import { OdooSyncProvider } from './odoo/sync';
import { FintocSyncProvider } from './fintoc/sync';
import { SyntageSyncProvider } from './syntage/sync';

// Register all providers
registerProvider(new OdooSyncProvider());
registerProvider(new FintocSyncProvider());
registerProvider(new SyntageSyncProvider());

// Re-export concrete providers for direct use
export { OdooSyncProvider } from './odoo/sync';
export { FintocSyncProvider } from './fintoc/sync';
export { SyntageSyncProvider, type SatSyncResult } from './syntage/sync';
