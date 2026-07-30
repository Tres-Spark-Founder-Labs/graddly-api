import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EncryptionService } from '../../common/crypto/encryption.service.js';

/** Encrypts TOTP secrets at rest, mirroring TokenEncryptionService's convention. */
@Injectable()
export class MfaEncryptionService extends EncryptionService {
  constructor(private readonly config: ConfigService) {
    super();
  }

  protected resolveKey(): Buffer {
    const configured = this.config.get<string>('app.security.mfaEncryptionKey');
    const fallback = this.config.get<string>('app.jwt.secret', '');
    const secret = configured?.trim() || fallback;
    return this.deriveKeyFromSecret(secret);
  }
}
