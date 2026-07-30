import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';

import { User } from '../../users/entities/user.entity.js';
import { UsersService } from '../../users/users.service.js';

import { MfaEncryptionService } from './mfa-encryption.service.js';
import { MfaService } from './mfa.service.js';

const mockUser = { id: 'user-1', email: 'jane@example.com' } as User;

const mockUsersService = {
  setPendingMfaSecret: jest.fn(),
  getMfaSecret: jest.fn(),
  enableMfa: jest.fn(),
  getMfaRecoveryCodes: jest.fn(),
  setMfaRecoveryCodes: jest.fn(),
  disableMfa: jest.fn(),
};

describe('MfaService', () => {
  let service: MfaService;
  let encryption: MfaEncryptionService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MfaService,
        MfaEncryptionService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: unknown) =>
              key === 'app.security.mfaEncryptionKey'
                ? 'test-mfa-key'
                : fallback,
            ),
          },
        },
        { provide: UsersService, useValue: mockUsersService },
      ],
    }).compile();

    service = moduleRef.get(MfaService);
    encryption = moduleRef.get(MfaEncryptionService);
  });

  describe('generateEnrollment', () => {
    it('generates and stores an encrypted secret, returning the plaintext secret and otpauth URL', async () => {
      const result = await service.generateEnrollment(mockUser);

      expect(result.secret).toMatch(/^[A-Z2-7]+$/u);
      expect(result.otpauthUrl).toContain('otpauth://totp/');
      expect(result.otpauthUrl).toContain(encodeURIComponent(mockUser.email));
      expect(mockUsersService.setPendingMfaSecret).toHaveBeenCalledWith(
        mockUser.id,
        expect.any(String),
      );

      const calls = mockUsersService.setPendingMfaSecret.mock.calls as [
        string,
        string,
      ][];
      expect(encryption.decrypt(calls[0][1])).toBe(result.secret);
    });
  });

  describe('confirmEnrollment', () => {
    it('throws BadRequestException when no enrollment is in progress', async () => {
      mockUsersService.getMfaSecret.mockResolvedValue(null);

      await expect(
        service.confirmEnrollment(mockUser.id, '123456'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws UnauthorizedException for an invalid code', async () => {
      const { secret } = await service.generateEnrollment(mockUser);
      mockUsersService.getMfaSecret.mockResolvedValue(
        encryption.encrypt(secret),
      );

      await expect(
        service.confirmEnrollment(mockUser.id, '000000'),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockUsersService.enableMfa).not.toHaveBeenCalled();
    });

    it('activates MFA and returns recovery codes for a valid code', async () => {
      const { secret } = await service.generateEnrollment(mockUser);
      mockUsersService.getMfaSecret.mockResolvedValue(
        encryption.encrypt(secret),
      );
      const code = authenticator.generate(secret);

      const result = await service.confirmEnrollment(mockUser.id, code);

      expect(result.recoveryCodes).toHaveLength(8);
      expect(new Set(result.recoveryCodes).size).toBe(8);
      expect(mockUsersService.enableMfa).toHaveBeenCalledWith(
        mockUser.id,
        expect.any(Array),
      );
    });
  });

  describe('verifyCode', () => {
    it('returns false when no secret is enrolled', async () => {
      mockUsersService.getMfaSecret.mockResolvedValue(null);

      await expect(service.verifyCode(mockUser.id, '123456')).resolves.toBe(
        false,
      );
    });

    it('returns true for a valid code', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      mockUsersService.getMfaSecret.mockResolvedValue(
        encryption.encrypt(secret),
      );
      const code = authenticator.generate(secret);

      await expect(service.verifyCode(mockUser.id, code)).resolves.toBe(true);
    });

    it('returns false for an incorrect code', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      mockUsersService.getMfaSecret.mockResolvedValue(
        encryption.encrypt(secret),
      );

      await expect(service.verifyCode(mockUser.id, '000000')).resolves.toBe(
        false,
      );
    });
  });

  describe('consumeRecoveryCode', () => {
    it('returns false when there are no recovery codes', async () => {
      mockUsersService.getMfaRecoveryCodes.mockResolvedValue(null);

      await expect(
        service.consumeRecoveryCode(mockUser.id, 'abc'),
      ).resolves.toBe(false);
    });

    it('consumes a matching code and removes only that code from the remaining list', async () => {
      const hashedA = await bcrypt.hash('recovery-code-a', 12);
      const hashedB = await bcrypt.hash('recovery-code-b', 12);
      mockUsersService.getMfaRecoveryCodes.mockResolvedValue([
        hashedA,
        hashedB,
      ]);

      await expect(
        service.consumeRecoveryCode(mockUser.id, 'recovery-code-a'),
      ).resolves.toBe(true);
      expect(mockUsersService.setMfaRecoveryCodes).toHaveBeenCalledWith(
        mockUser.id,
        [hashedB],
      );
    });

    it('returns false for a non-matching code and does not modify the list', async () => {
      const hashed = await bcrypt.hash('recovery-code-a', 12);
      mockUsersService.getMfaRecoveryCodes.mockResolvedValue([hashed]);

      await expect(
        service.consumeRecoveryCode(mockUser.id, 'wrong-code'),
      ).resolves.toBe(false);
      expect(mockUsersService.setMfaRecoveryCodes).not.toHaveBeenCalled();
    });
  });

  describe('disableMfa', () => {
    it('throws UnauthorizedException for an invalid code and leaves MFA enabled', async () => {
      mockUsersService.getMfaSecret.mockResolvedValue(null);

      await expect(service.disableMfa(mockUser.id, '123456')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockUsersService.disableMfa).not.toHaveBeenCalled();
    });

    it('disables MFA for a valid code', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      mockUsersService.getMfaSecret.mockResolvedValue(
        encryption.encrypt(secret),
      );
      const code = authenticator.generate(secret);

      await service.disableMfa(mockUser.id, code);

      expect(mockUsersService.disableMfa).toHaveBeenCalledWith(mockUser.id);
    });
  });
});
