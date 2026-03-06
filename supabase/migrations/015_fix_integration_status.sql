-- Fix integrations status: set 'valid' for connected integrations that are stuck at 'pending'
UPDATE integrations
SET status = 'valid'
WHERE is_connected = true
  AND (status = 'pending' OR status IS NULL);

-- Fix integrations that have config saved but is_connected was never set to true
UPDATE integrations
SET is_connected = true, status = 'valid'
WHERE is_connected = false
  AND config IS NOT NULL
  AND config::text != 'null'
  AND (status = 'pending' OR status IS NULL OR status = 'valid');

-- Set 'disconnected' for explicitly disconnected integrations
UPDATE integrations
SET status = 'disconnected'
WHERE is_connected = false
  AND config IS NULL
  AND (status = 'pending' OR status IS NULL);
