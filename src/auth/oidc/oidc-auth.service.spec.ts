import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { User } from '../../users/entities/user.entity.js';
import { AuthService } from '../auth.service.js';

import { OidcAccountLinkingService } from './oidc-account-linking.service.js';
import { OidcAuthService } from './oidc-auth.service.js';
import { OidcConfigurationService } from './oidc-configuration.service.js';

describe('OidcAuthService', () => {
  let service: OidcAuthService;

  const authService = {
    issueTokensForUser: jest.fn(),
  };

  const oidcAccountLinking = {
    resolveUserForLogin: jest.fn(),
  };

  const oidcConfiguration = {
    getIssuer: jest.fn(),
  };

  const configService = {
    get: jest.fn(),
  };

  const mockUser = {
    id: 'user-1',
    email: 'user@example.com',
    isActive: true,
  } as User;

  beforeEach(async () => {
    jest.clearAllMocks();
    authService.issueTokensForUser.mockResolvedValue({
      accessToken: 'access',
      refreshToken: 'refresh',
    });
    oidcConfiguration.getIssuer.mockReturnValue('https://oidc.test.example');
    oidcAccountLinking.resolveUserForLogin.mockResolvedValue(mockUser);
    configService.get.mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OidcAuthService,
        { provide: AuthService, useValue: authService },
        { provide: OidcAccountLinkingService, useValue: oidcAccountLinking },
        { provide: OidcConfigurationService, useValue: oidcConfiguration },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(OidcAuthService);
  });

  it('issues tokens for verified email with resolved user', async () => {
    const tokens = await service.completeLogin({
      sub: 'one-login-sub',
      email: 'user@example.com',
      emailVerified: true,
    });

    expect(tokens).toEqual({ accessToken: 'access', refreshToken: 'refresh' });
    expect(oidcConfiguration.getIssuer).toHaveBeenCalled();
    expect(oidcAccountLinking.resolveUserForLogin).toHaveBeenCalledWith(
      {
        sub: 'one-login-sub',
        email: 'user@example.com',
        emailVerified: true,
      },
      'https://oidc.test.example',
    );
    expect(authService.issueTokensForUser).toHaveBeenCalledWith(mockUser);
  });

  it('rejects when email is missing', async () => {
    await expect(
      service.completeLogin({ sub: 'one-login-sub', emailVerified: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(oidcAccountLinking.resolveUserForLogin).not.toHaveBeenCalled();
  });

  it('rejects when email is not verified', async () => {
    await expect(
      service.completeLogin({
        sub: 'one-login-sub',
        email: 'user@example.com',
        emailVerified: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(oidcAccountLinking.resolveUserForLogin).not.toHaveBeenCalled();
  });

  it('rejects deactivated accounts', async () => {
    oidcAccountLinking.resolveUserForLogin.mockResolvedValue({
      ...mockUser,
      isActive: false,
    });

    await expect(
      service.completeLogin({
        sub: 'one-login-sub',
        email: 'user@example.com',
        emailVerified: true,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns configured success redirect URI', () => {
    configService.get.mockReturnValue('https://app.example.com/auth/callback');

    expect(service.getSuccessRedirectUri()).toBe(
      'https://app.example.com/auth/callback',
    );
  });

  it('builds success redirect URL with fragment tokens', () => {
    configService.get.mockReturnValue('https://app.example.com/auth/callback');

    const url = service.buildSuccessRedirectUrl({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });

    expect(url).toBe(
      'https://app.example.com/auth/callback#accessToken=access-token&refreshToken=refresh-token',
    );
  });
});
