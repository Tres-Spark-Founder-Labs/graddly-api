import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TokenEncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly ivLength = 12;

  constructor(private readonly config: ConfigService) {}

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

  private resolveKey(): Buffer {
    const configured = this.config.get<string>(
      'app.levyExchange.donorOAuth.tokenEncryptionKey',
    );
    const fallback = this.config.get<string>('app.jwt.secret', '');
    const secret = configured?.trim() || fallback;
    return createHash('sha256').update(secret).digest();
  }
}
