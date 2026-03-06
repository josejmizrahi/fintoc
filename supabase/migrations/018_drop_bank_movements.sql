-- Phase 3: Movements are fetched from Fintoc API on demand (treasury/movements, reconciliation/banco-app).
-- No longer store bank_movements in the app.

DROP TABLE IF EXISTS bank_movements CASCADE;
