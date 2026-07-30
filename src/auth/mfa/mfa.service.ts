import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';

import { User } from '../../users/entities/user.entity.js';
import { UsersService } from '../../users/users.service.js';

import { MfaConfirmResponseDto } from './dto/mfa-confirm-response.dto.js';
import { MfaEnrollResponseDto } from './dto/mfa-enroll-response.dto.js';
import { MfaEncryptionService } from './mfa-encryption.service.js';

const ISSUER = 'Graddly';
const RECOVERY_CODE_COUNT = 8;
const RECOVERY_CODE_SALT_ROUNDS = 12;

/** Accept codes valid one time-step (30s) either side of now, to absorb clock drift. */
authenticator.options = { window: 1 };

@Injectable()
export class MfaService {
  constructor(
    private readonly usersService: UsersService,
    private readonly encryption: MfaEncryptionService,
  ) {}

  /** Starts (or restarts) enrollment: generates a new secret, not yet active until confirmed. */
  async generateEnrollment(user: User): Promise<MfaEnrollResponseDto> {
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.email, ISSUER, secret);
    await this.usersService.setPendingMfaSecret(
      user.id,
      this.encryption.encrypt(secret),
    );
    return { secret, otpauthUrl };
  }

  /** Verifies the first code against the pending secret, then activates MFA and issues recovery codes. */
  async confirmEnrollment(
    userId: string,
    code: string,
  ): Promise<MfaConfirmResponseDto> {
    const encryptedSecret = await this.usersService.getMfaSecret(userId);
    if (!encryptedSecret) {
      throw new BadRequestException(
        'No MFA enrollment in progress. Call POST /auth/mfa/enroll first.',
      );
    }

    const secret = this.encryption.decrypt(encryptedSecret);
    if (!authenticator.check(code, secret)) {
      throw new UnauthorizedException('Invalid code');
    }

    const recoveryCodes = this.generateRecoveryCodes();
    const hashed = await Promise.all(
      recoveryCodes.map((c) => bcrypt.hash(c, RECOVERY_CODE_SALT_ROUNDS)),
    );
    await this.usersService.enableMfa(userId, hashed);

    return { recoveryCodes };
  }

  /** Verifies a TOTP code for an already-enrolled user (login step 2, or pre-disable check). */
  async verifyCode(userId: string, code: string): Promise<boolean> {
    const encryptedSecret = await this.usersService.getMfaSecret(userId);
    if (!encryptedSecret) {
      return false;
    }

    const secret = this.encryption.decrypt(encryptedSecret);
    return authenticator.check(code, secret);
  }

  /** Consumes a single-use recovery code if it matches; returns whether it was valid. */
  async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    const codes = await this.usersService.getMfaRecoveryCodes(userId);
    if (!codes || codes.length === 0) {
      return false;
    }

    const matches = await Promise.all(
      codes.map((hash) => bcrypt.compare(code, hash)),
    );
    const index = matches.indexOf(true);
    if (index === -1) {
      return false;
    }

    const remaining = [...codes.slice(0, index), ...codes.slice(index + 1)];
    await this.usersService.setMfaRecoveryCodes(userId, remaining);
    return true;
  }

  async disableMfa(userId: string, code: string): Promise<void> {
    const valid = await this.verifyCode(userId, code);
    if (!valid) {
      throw new UnauthorizedException('Invalid code');
    }
    await this.usersService.disableMfa(userId);
  }

  private generateRecoveryCodes(): string[] {
    return Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      randomBytes(5).toString('hex'),
    );
  }
}
