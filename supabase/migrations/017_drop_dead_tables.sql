-- Phase 1: Drop tables that are unused or replaced by external APIs (Syntage, Odoo).
-- - cfdi_documents: not used by any API route; Syntage is source of truth for CFDI
-- - reconciliation_entries: reconciliation returns in-memory results only
-- - sync_logs: replaced by sync_history (v2 sync engine)
-- - sat_download_requests, sat_cancellation_requests: replaced by Syntage
-- - rfc_validations: not used by any route

DROP TABLE IF EXISTS reconciliation_entries CASCADE;
DROP TABLE IF EXISTS cfdi_documents CASCADE;
DROP TABLE IF EXISTS sync_logs CASCADE;
DROP TABLE IF EXISTS sat_cancellation_requests CASCADE;
DROP TABLE IF EXISTS sat_download_requests CASCADE;
DROP TABLE IF EXISTS rfc_validations CASCADE;
