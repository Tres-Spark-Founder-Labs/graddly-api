import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

/**
 * AES-256-GCM encrypt/decrypt with a `iv.authTag.ciphertext` (base64url)
 * envelope. Concrete subclasses only need to supply the key material via
 * `resolveKey()` — e.g. from a config-specific secret with a JWT-secret
 * fallback, matching the convention already used for donor OAuth tokens.
 */
export abstract class EncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly ivLength = 12;

  protected abstract resolveKey(): Buffer;

  encrypt(plaintext: string): string {
    const key = this.resolveKey();
    const iv = randomBytes(this.ivLength);
    const cipher = createCipheriv(this.algorithm, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
      iv.toString('base64url'),
      authTag.toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.');
  }

  decrypt(ciphertext: string): string {
    const key = this.resolveKey();
    const [ivPart, authTagPart, encryptedPart] = ciphertext.split('.');
    if (!ivPart || !authTagPart || !encryptedPart) {
      throw new Error('Invalid encrypted token format');
    }

    const iv = Buffer.from(ivPart, 'base64url');
    const authTag = Buffer.from(authTagPart, 'base64url');
    const encrypted = Buffer.from(encryptedPart, 'base64url');
    const decipher = createDecipheriv(this.algorithm, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  }

  protected deriveKeyFromSecret(secret: string): Buffer {
    return createHash('sha256').update(secret).digest();
  }
}
