-- Unify invoice date columns: date_due → due_date, date_invoice → invoice_date
UPDATE invoices SET due_date = date_due WHERE due_date IS NULL AND date_due IS NOT NULL;
UPDATE invoices SET invoice_date = date_invoice WHERE invoice_date IS NULL AND date_invoice IS NOT NULL;
ALTER TABLE invoices DROP COLUMN IF EXISTS date_due;
ALTER TABLE invoices DROP COLUMN IF EXISTS date_invoice;
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices (due_date) WHERE amount_residual > 0;
