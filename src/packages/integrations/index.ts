/**
 * Integration Registry
 *
 * Registers sync providers on import. SAT (Syntage) data is updated via webhooks;
 * no periodic sync provider for syntage.
 */
import { registerProvider } from '@/packages/sync-engine';
import { OdooSyncProvider } from './odoo/sync';
import { FintocSyncProvider } from './fintoc/sync';

// Register providers (syntage/sat removed — webhooks + on-demand extractions only)
registerProvider(new OdooSyncProvider());
registerProvider(new FintocSyncProvider());

// Re-export for direct use
export { OdooSyncProvider } from './odoo/sync';
export { FintocSyncProvider } from './fintoc/sync';
