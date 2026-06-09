import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { DasDonorOAuthService } from './services/das-donor-oauth.service.js';
import { TokenEncryptionService } from './services/token-encryption.service.js';

describe('DasDonorOAuthService', () => {
  let service: DasDonorOAuthService;

  const encrypt = jest.fn((value: string) => `enc:${value}`);
  const decrypt = jest.fn((value: string) => value.replace(/^enc:/, ''));

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DasDonorOAuthService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: unknown) => {
              switch (key) {
                case 'app.levyExchange.donorOAuth.authorizeUrl':
                  return 'https://das.example.com/oauth/authorize';
                case 'app.levyExchange.donorOAuth.tokenUrl':
                  return 'https://das.example.com/oauth/token';
                case 'app.levyExchange.donorOAuth.clientId':
                  return 'client-id';
                case 'app.levyExchange.donorOAuth.clientSecret':
                  return 'client-secret';
                case 'app.levyExchange.donorOAuth.redirectUri':
                  return 'https://api.example.com/callback';
                case 'app.levyExchange.donorOAuth.scope':
                  return 'levy.read';
                case 'app.das.timeoutMs':
                  return 5000;
                case 'app.jwt.secret':
                  return 'jwt-secret-for-state';
                default:
                  return fallback;
              }
            }),
          },
        },
        {
          provide: TokenEncryptionService,
          useValue: { encrypt, decrypt },
        },
      ],
    }).compile();

    service = moduleRef.get(DasDonorOAuthService);
    jest.clearAllMocks();
  });

  it('reports configured when all OAuth settings present', () => {
    expect(service.isConfigured()).toBe(true);
  });

  it('builds authorize URL with signed state', () => {
    const url = service.buildAuthorizeUrl('link-1', 'org-1', 'user-1');
    expect(url).toContain('https://das.example.com/oauth/authorize');
    expect(url).toContain('client_id=client-id');
    expect(url).toContain('state=');
  });

  it('verifies valid state', () => {
    const url = service.buildAuthorizeUrl('link-1', 'org-1', 'user-1');
    const state = new URL(url).searchParams.get('state')!;
    const payload = service.verifyState(state);
    expect(payload).toMatchObject({
      linkId: 'link-1',
      orgId: 'org-1',
      userId: 'user-1',
    });
  });

  it('rejects invalid state', () => {
    expect(() => service.verifyState('bad-state')).toThrow(BadRequestException);
  });

  it('exchanges authorization code for tokens', async () => {
    const oauthPayload: Record<string, unknown> = {
      scope: 'levy.read',
    };
    oauthPayload['access_token'] = 'access-1';
    oauthPayload['refresh_token'] = 'refresh-1';
    oauthPayload['expires_in'] = 3600;

    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(oauthPayload), { status: 200 }),
      );

    const result = await service.exchangeCode('auth-code');
    expect(result.accessToken).toBe('access-1');
    expect(result.refreshToken).toBe('refresh-1');
    expect(result.scope).toBe('levy.read');
  });

  it('returns cached token when not near expiry', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const token = {
      accessTokenEncrypted: 'enc:cached-access',
      refreshTokenEncrypted: 'enc:cached-refresh',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      scope: 'levy.read',
    } as never;

    const result = await service.refreshToken(token);
    expect(result.accessToken).toBe('cached-access');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('encrypts token payload', () => {
    const expiresAt = new Date('2027-01-01T00:00:00.000Z');
    const result = service.encryptTokenPayload({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt,
      scope: 'levy.read',
    });
    expect(result.accessTokenEncrypted).toBe('enc:access');
    expect(result.refreshTokenEncrypted).toBe('enc:refresh');
    expect(result.expiresAt).toBe(expiresAt);
  });

  it('throws when OAuth is not configured', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DasDonorOAuthService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn(() => undefined) },
        },
        {
          provide: TokenEncryptionService,
          useValue: { encrypt, decrypt },
        },
      ],
    }).compile();
    const unconfigured = moduleRef.get(DasDonorOAuthService);
    expect(unconfigured.isConfigured()).toBe(false);
    expect(() =>
      unconfigured.buildAuthorizeUrl('link-1', 'org-1', 'user-1'),
    ).toThrow(ServiceUnavailableException);
  });
});
