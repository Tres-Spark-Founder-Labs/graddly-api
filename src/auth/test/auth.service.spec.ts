import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { EmailDispatchService } from '../../email/email-dispatch.service.js';
import { OrganisationMembership } from '../../organisations/entities/organisation-membership.entity.js';
import { OrganisationRole } from '../../organisations/organisation-role.enum.js';
import { RedisService } from '../../redis/redis.service.js';
import { User } from '../../users/entities/user.entity.js';
import { UsersService } from '../../users/users.service.js';
import { AuthService } from '../auth.service.js';
import { RefreshTokenService } from '../refresh-token.service.js';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
}));

const { compare: mockCompare } = jest.requireMock<{
  compare: jest.Mock;
}>('bcrypt');

const mockUser: User = {
  id: 'user-uuid-1',
  title: null,
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  password: '$2b$12$hashedpassword',
  isEmailVerified: false,
  isActive: true,
  avatarUrl: null,
  phone: null,
  dateOfBirth: null,
  gender: null,
  jobTitle: null,
  department: null,
  bio: null,
  locale: 'en-GB',
  timezone: 'Europe/London',
  lastLoginAt: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  isDeleted: false,
  deletedAt: null,
} as never;

const mockUsersService = {
  create: jest.fn(),
  findById: jest.fn(),
  findByEmail: jest.fn(),
  updateLastLoginAt: jest.fn().mockResolvedValue(undefined),
  updatePassword: jest.fn(),
  markEmailVerified: jest.fn(),
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('signed-jwt-token'),
};

const mockConfigService = {
  get: jest.fn((key: string, fallback?: string) => {
    const values: Record<string, string | number> = {
      ['app.jwt.accessExpiresInSeconds']: 900,
      ['app.passwordReset.tokenTtlSeconds']: 3600,
      ['app.emailVerification.tokenTtlSeconds']: 86_400,
    };
    return values[key] ?? fallback;
  }),
};

const mockRefreshTokenService = {
  issue: jest.fn().mockResolvedValue('new-refresh-token'),
  consume: jest.fn(),
  revoke: jest.fn(),
  revokeAllForUser: jest.fn(),
};

const mockRedisService = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

const mockEmailDispatch = {
  enqueue: jest.fn(),
};

const mockMembershipQueryBuilder = {
  innerJoin: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  addOrderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  getRawOne: jest.fn(),
  getRawMany: jest.fn(),
};

const mockMembershipRepo = {
  find: jest.fn(),
  createQueryBuilder: jest.fn(() => mockMembershipQueryBuilder),
};

describe('AuthService', () => {
  let authService: AuthService;

  beforeEach(async () => {
    mockMembershipRepo.find.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: RedisService, useValue: mockRedisService },
        {
          provide: RefreshTokenService,
          useValue: mockRefreshTokenService,
        },
        { provide: EmailDispatchService, useValue: mockEmailDispatch },
        {
          provide: getRepositoryToken(OrganisationMembership),
          useValue: mockMembershipRepo,
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
    mockMembershipRepo.find.mockResolvedValue([]);
  });

  describe('signup', () => {
    const dto = {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      password: 'P@ssw0rd!',
    };

    it('should create a user and send verification email without tokens', async () => {
      mockUsersService.create.mockResolvedValue(mockUser);
      mockEmailDispatch.enqueue.mockResolvedValue(undefined);

      await authService.signup(dto);

      expect(mockUsersService.create).toHaveBeenCalledWith(dto);
      expect(mockRedisService.set).toHaveBeenCalledWith(
        expect.stringMatching(/^email-verify:/u),
        mockUser.id,
        86_400,
      );
      expect(mockEmailDispatch.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          to: mockUser.email,
          template: 'email-verification',
        }),
      );
      expect(mockJwtService.sign).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    const dto = { email: 'john@example.com', password: 'P@ssw0rd!' };

    it('should return tokens for valid credentials when email is verified', async () => {
      mockUsersService.findByEmail.mockResolvedValue({
        ...mockUser,
        isEmailVerified: true,
      });
      mockCompare.mockResolvedValue(true);

      const result = await authService.login(dto);

      expect(mockUsersService.findByEmail).toHaveBeenCalledWith(dto.email);
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });

    it('should throw ForbiddenException when email is not verified', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      mockCompare.mockResolvedValue(true);

      await expect(authService.login(dto)).rejects.toThrow(
        new ForbiddenException('Email address not verified'),
      );
    });

    it('should throw UnauthorizedException if user not found', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);

      await expect(authService.login(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if account is deactivated', async () => {
      mockUsersService.findByEmail.mockResolvedValue({
        ...mockUser,
        isActive: false,
      });

      await expect(authService.login(dto)).rejects.toThrow(
        new UnauthorizedException('Account is deactivated'),
      );
    });

    it('should throw UnauthorizedException if password is wrong', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      mockCompare.mockResolvedValue(false);

      await expect(authService.login(dto)).rejects.toThrow(
        new UnauthorizedException('Invalid credentials'),
      );
    });
  });

  describe('refresh', () => {
    const refreshToken = 'valid-refresh-uuid';

    it('should return new tokens for a valid refresh token when email is verified', async () => {
      mockRefreshTokenService.consume.mockResolvedValue({
        userId: mockUser.id,
        newRefreshToken: 'rotated-refresh-token',
      });
      mockUsersService.findById.mockResolvedValue({
        ...mockUser,
        isEmailVerified: true,
      });

      const result = await authService.refresh(refreshToken);

      expect(mockRefreshTokenService.consume).toHaveBeenCalledWith(
        refreshToken,
      );
      expect(result).toEqual({
        accessToken: 'signed-jwt-token',
        refreshToken: 'rotated-refresh-token',
      });
    });

    it('should throw UnauthorizedException for invalid refresh token', async () => {
      mockRefreshTokenService.consume.mockRejectedValue(
        new UnauthorizedException('Invalid or expired refresh token'),
      );

      await expect(authService.refresh(refreshToken)).rejects.toThrow(
        new UnauthorizedException('Invalid or expired refresh token'),
      );
    });

    it('should throw ForbiddenException when email is not verified', async () => {
      mockRefreshTokenService.consume.mockResolvedValue({
        userId: mockUser.id,
        newRefreshToken: 'rotated-refresh-token',
      });
      mockUsersService.findById.mockResolvedValue(mockUser);

      await expect(authService.refresh(refreshToken)).rejects.toThrow(
        new ForbiddenException('Email address not verified'),
      );
    });
  });

  describe('logout', () => {
    it('should revoke the refresh token', async () => {
      const refreshToken = 'token-to-invalidate';

      await authService.logout(refreshToken);

      expect(mockRefreshTokenService.revoke).toHaveBeenCalledWith(refreshToken);
    });
  });

  describe('logoutAll', () => {
    it('should revoke all refresh sessions for the user', async () => {
      await authService.logoutAll(mockUser.id);

      expect(mockRefreshTokenService.revokeAllForUser).toHaveBeenCalledWith(
        mockUser.id,
      );
    });
  });

  describe('requestPasswordReset', () => {
    it('stores token and sends email for active user', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      mockEmailDispatch.enqueue.mockResolvedValue(undefined);

      await authService.requestPasswordReset(mockUser.email);

      expect(mockRedisService.set).toHaveBeenCalledWith(
        expect.stringMatching(/^password-reset:/u),
        mockUser.id,
        3600,
      );
      expect(mockEmailDispatch.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          to: mockUser.email,
          template: 'password-reset',
        }),
      );
    });

    it('does nothing when user is unknown', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);

      await authService.requestPasswordReset('unknown@example.com');

      expect(mockRedisService.set).not.toHaveBeenCalled();
      expect(mockEmailDispatch.enqueue).not.toHaveBeenCalled();
    });

    it('does not throw when email send fails', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      mockEmailDispatch.enqueue.mockRejectedValue(new Error('Resend down'));

      await expect(
        authService.requestPasswordReset(mockUser.email),
      ).resolves.toBeUndefined();
    });
  });

  describe('resetPassword', () => {
    const token = '550e8400-e29b-41d4-a716-446655440000';

    it('updates password and returns tokens for valid token', async () => {
      mockRedisService.get.mockResolvedValue(mockUser.id);
      mockUsersService.findById.mockResolvedValue(mockUser);

      const result = await authService.resetPassword(token, 'N3wP@ssw0rd!');

      expect(mockRedisService.del).toHaveBeenCalledWith(
        `password-reset:${token}`,
      );
      expect(mockUsersService.updatePassword).toHaveBeenCalledWith(
        mockUser.id,
        'N3wP@ssw0rd!',
      );
      expect(mockRefreshTokenService.revokeAllForUser).toHaveBeenCalledWith(
        mockUser.id,
      );
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });

    it('throws for invalid token', async () => {
      mockRedisService.get.mockResolvedValue(null);

      await expect(
        authService.resetPassword(token, 'N3wP@ssw0rd!'),
      ).rejects.toThrow(
        new UnauthorizedException('Invalid or expired password reset token'),
      );
    });
  });

  describe('verifyEmail', () => {
    const token = '550e8400-e29b-41d4-a716-446655440001';

    it('marks email verified and returns tokens for valid token', async () => {
      mockRedisService.get.mockResolvedValue(mockUser.id);
      mockUsersService.findById.mockResolvedValue({
        ...mockUser,
        isEmailVerified: true,
      });

      const result = await authService.verifyEmail(token);

      expect(mockRedisService.del).toHaveBeenCalledWith(
        `email-verify:${token}`,
      );
      expect(mockUsersService.markEmailVerified).toHaveBeenCalledWith(
        mockUser.id,
      );
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });

    it('throws for invalid token', async () => {
      mockRedisService.get.mockResolvedValue(null);

      await expect(authService.verifyEmail(token)).rejects.toThrow(
        new UnauthorizedException(
          'Invalid or expired email verification token',
        ),
      );
    });
  });

  describe('resendVerification', () => {
    it('sends email for active unverified user', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      mockEmailDispatch.enqueue.mockResolvedValue(undefined);

      await authService.resendVerification(mockUser.email);

      expect(mockEmailDispatch.enqueue).toHaveBeenCalled();
    });

    it('does nothing when user is already verified', async () => {
      mockUsersService.findByEmail.mockResolvedValue({
        ...mockUser,
        isEmailVerified: true,
      });

      await authService.resendVerification(mockUser.email);

      expect(mockRedisService.set).not.toHaveBeenCalled();
      expect(mockEmailDispatch.enqueue).not.toHaveBeenCalled();
    });

    it('does nothing when user is unknown', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);

      await authService.resendVerification('unknown@example.com');

      expect(mockEmailDispatch.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('issueTokensForUser', () => {
    it('returns access and refresh tokens for an existing user', async () => {
      mockUsersService.findById.mockResolvedValue({
        ...mockUser,
        isEmailVerified: true,
      });
      mockMembershipRepo.find.mockResolvedValue([]);

      const result = await authService.issueTokensForUser({
        ...mockUser,
        isEmailVerified: true,
      });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(mockJwtService.sign).toHaveBeenCalled();
    });
  });

  describe('resolveActiveOrganisationForUser', () => {
    it('returns null when user has no active membership', async () => {
      mockMembershipQueryBuilder.getRawOne.mockResolvedValue(null);

      const result = await authService.resolveActiveOrganisationForUser(
        mockUser.id,
      );

      expect(result).toBeNull();
    });

    it('returns active organisation when membership exists', async () => {
      mockMembershipQueryBuilder.getRawOne.mockResolvedValue({
        mRole: OrganisationRole.OWNER,
        mStatus: 'active',
        oId: 'org-1',
        oName: 'Acme',
        oSlug: 'acme',
        oType: null,
        oPortalType: null,
        oUkprn: null,
        oAddress: null,
        oCity: null,
        oPostcode: null,
        oCountry: null,
        oOrgEmail: null,
        oOrgPhone: null,
        oWebsite: null,
        oLogoUrl: null,
      });

      const result = await authService.resolveActiveOrganisationForUser(
        mockUser.id,
      );

      expect(result?.organisation.id).toBe('org-1');
      expect(result?.roles).toEqual([OrganisationRole.OWNER]);
    });

    it('throws when requested organisation is not a membership', async () => {
      mockMembershipQueryBuilder.getRawOne.mockResolvedValue(null);

      await expect(
        authService.resolveActiveOrganisationForUser(
          mockUser.id,
          'org-unknown',
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('resolveOrganisationsForUser', () => {
    it('returns lightweight org list ordered by role priority', async () => {
      mockMembershipQueryBuilder.getRawMany.mockResolvedValue([
        { oId: 'org-1', oName: 'Acme', oPortalType: null, oSlug: 'acme' },
      ]);

      const result = await authService.resolveOrganisationsForUser(mockUser.id);

      expect(result).toEqual([
        { id: 'org-1', name: 'Acme', portalType: null, slug: 'acme' },
      ]);
    });
  });

  describe('JWT payload (org claims)', () => {
    const dto = { email: 'john@example.com', password: 'P@ssw0rd!' };
    const verifiedUser = { ...mockUser, isEmailVerified: true };

    it('signs access token without orgId when user has no memberships', async () => {
      mockUsersService.findByEmail.mockResolvedValue(verifiedUser);
      mockCompare.mockResolvedValue(true);
      mockMembershipRepo.find.mockResolvedValue([]);

      await authService.login(dto);

      expect(mockJwtService.sign).toHaveBeenCalledWith(
        {
          sub: mockUser.id,
          email: mockUser.email,
        },
        expect.any(Object),
      );
    });

    it('includes orgId and roles when active membership exists', async () => {
      mockUsersService.findByEmail.mockResolvedValue(verifiedUser);
      mockCompare.mockResolvedValue(true);
      mockMembershipRepo.find.mockResolvedValue([
        {
          role: OrganisationRole.MEMBER,
          createdAt: new Date('2026-02-01'),
          organisation: { id: 'org-later' },
        },
        {
          role: OrganisationRole.OWNER,
          createdAt: new Date('2026-01-01'),
          organisation: { id: 'org-earlier' },
        },
      ]);

      await authService.login(dto);

      expect(mockJwtService.sign).toHaveBeenCalledWith(
        {
          sub: mockUser.id,
          email: mockUser.email,
          orgId: 'org-earlier',
          roles: [OrganisationRole.OWNER],
        },
        expect.any(Object),
      );
    });
  });
});
