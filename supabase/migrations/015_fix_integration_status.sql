-- Fix integrations status: set 'valid' for connected integrations that are stuck at 'pending'
UPDATE integrations
SET status = 'valid'
WHERE is_connected = true
  AND (status = 'pending' OR status IS NULL);

-- Set 'disconnected' for explicitly disconnected integrations
UPDATE integrations
SET status = 'disconnected'
WHERE is_connected = false
  AND config IS NULL
  AND (status = 'pending' OR status IS NULL);
