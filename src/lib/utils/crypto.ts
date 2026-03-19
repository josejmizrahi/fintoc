import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

let _encryptionWarned = false;

function getEncryptionKey(): Buffer | null {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    if (!_encryptionWarned) {
      console.warn('[crypto] ENCRYPTION_KEY not set — credentials will be stored in plaintext. Set a 64-char hex key for encryption.');
      _encryptionWarned = true;
    }
    return null;
  }
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    console.error('[crypto] ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Current length:', key.length);
    return null;
  }
  return Buffer.from(key, 'hex');
}

/** Returns true if ENCRYPTION_KEY is properly configured */
export function isEncryptionAvailable(): boolean {
  return getEncryptionKey() !== null;
}

/**
 * Encrypt data using AES-256-GCM.
 * Returns null if ENCRYPTION_KEY is not configured (caller should store plaintext).
 */
export function encrypt(data: Record<string, unknown>): Buffer | null {
  const key = getEncryptionKey();
  if (!key) return null;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const plaintext = JSON.stringify(data);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  // Format: [iv (12 bytes)][tag (16 bytes)][ciphertext]
  return Buffer.concat([iv, tag, encrypted]);
}

/**
 * Decrypt data encrypted with encrypt().
 * Returns null if decryption fails (key mismatch, missing key, corrupt data).
 */
export function decrypt(encrypted: Buffer | string): Record<string, unknown> | null {
  const key = getEncryptionKey();
  if (!key) {
    console.warn('[crypto] Cannot decrypt — ENCRYPTION_KEY not configured');
    return null;
  }

  try {
    // Supabase returns bytea columns as hex or base64 strings, not Buffers
    let buf: Buffer;
    if (Buffer.isBuffer(encrypted)) {
      buf = encrypted;
    } else if (typeof encrypted === 'string') {
      buf = encrypted.startsWith('\\x')
        ? Buffer.from(encrypted.slice(2), 'hex')
        : Buffer.from(encrypted, 'base64');
    } else {
      console.error('[crypto] config_encrypted must be a Buffer or string, got:', typeof encrypted);
      return null;
    }

    if (buf.length < IV_LENGTH + TAG_LENGTH + 1) {
      console.error('[crypto] Encrypted data too short:', buf.length, 'bytes');
      return null;
    }

    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString('utf8')) as Record<string, unknown>;
  } catch (err) {
    console.error('[crypto] Decryption failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
