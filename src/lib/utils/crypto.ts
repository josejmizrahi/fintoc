import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }
  return Buffer.from(key, 'hex');
}

export function encrypt(data: Record<string, unknown>): Buffer {
  const key = getEncryptionKey();
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

export function decrypt(encrypted: Buffer | string): Record<string, unknown> {
  const key = getEncryptionKey();

  // Supabase returns bytea columns as hex or base64 strings, not Buffers
  let buf: Buffer;
  if (Buffer.isBuffer(encrypted)) {
    buf = encrypted;
  } else if (typeof encrypted === 'string') {
    buf = encrypted.startsWith('\\x')
      ? Buffer.from(encrypted.slice(2), 'hex')
      : Buffer.from(encrypted, 'base64');
  } else {
    throw new Error('config_encrypted must be a Buffer or string');
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
}
