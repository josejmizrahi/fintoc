-- Ensure approval_rules have amount_min/amount_max set (used by payments matching).
-- Seed and legacy data may only have min_amount/max_amount.

UPDATE approval_rules
SET amount_min = COALESCE(amount_min, min_amount, 0),
    amount_max = COALESCE(amount_max, max_amount)
WHERE amount_min IS NULL OR (amount_max IS NULL AND max_amount IS NOT NULL);
