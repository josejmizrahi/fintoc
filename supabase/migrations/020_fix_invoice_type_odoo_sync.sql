-- Fix invoices synced from Odoo that have type = move_type (in_invoice, out_invoice, etc.)
-- so they use app types 'payable' and 'receivable' and appear in Facturas tabs.

UPDATE invoices
SET type = CASE
  WHEN type IN ('in_invoice', 'in_refund') THEN 'payable'
  WHEN type IN ('out_invoice', 'out_refund') THEN 'receivable'
  ELSE type
END
WHERE type IN ('in_invoice', 'in_refund', 'out_invoice', 'out_refund');
