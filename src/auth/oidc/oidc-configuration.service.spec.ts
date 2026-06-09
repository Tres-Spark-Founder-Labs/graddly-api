/* eslint-disable @typescript-eslint/naming-convention -- ConfigService keys and OIDC metadata mirror external APIs */

import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Configuration, discovery } from 'openid-client';

import { OidcConfigurationService } from './oidc-configuration.service.js';

jest.mock('openid-client', () => ({
  discovery: jest.fn(),
  ClientSecretPost: jest.fn(() => jest.fn()),
}));

describe('OidcConfigurationService', () => {
  let service: OidcConfigurationService;

  const discoveryMock = jest.mocked(discovery);

  function createModule(oidcConfig: Record<string, unknown>): Promise<void> {
    return Test.createTestingModule({
      providers: [
        OidcConfigurationService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              const map: Record<string, unknown> = {
                'app.oidc.enabled': oidcConfig.enabled ?? false,
                'app.oidc.discoveryUrl': oidcConfig.discoveryUrl,
                'app.oidc.issuer': oidcConfig.issuer,
                'app.oidc.clientId': oidcConfig.clientId ?? 'client-id',
                'app.oidc.clientSecret': oidcConfig.clientSecret ?? 'secret',
                'app.oidc.redirectUri':
                  oidcConfig.redirectUri ??
                  'http://localhost:3000/api/v1/auth/oidc/callback',
                'app.oidc.scopes': oidcConfig.scopes ?? ['openid', 'email'],
                'app.oidc.uiLocales': oidcConfig.uiLocales ?? 'en',
                'app.oidc.vtr': oidcConfig.vtr,
              };
              return map[key] ?? defaultValue;
            }),
          },
        },
      ],
    })
      .compile()
      .then((module) => {
        service = module.get(OidcConfigurationService);
        return service.initialize();
      });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    discoveryMock.mockResolvedValue({} as Configuration);
  });

  it('skips discovery when OIDC is disabled', async () => {
    await createModule({ enabled: false });

    expect(discoveryMock).not.toHaveBeenCalled();
    expect(service.getConfiguration()).toBeUndefined();
    expect(service.isEnabled()).toBe(false);
  });

  it('discovers configuration from issuer when enabled', async () => {
    await createModule({
      enabled: true,
      issuer: 'https://oidc.integration.account.gov.uk',
    });

    expect(discoveryMock).toHaveBeenCalledWith(
      new URL('https://oidc.integration.account.gov.uk'),
      'client-id',
      {
        redirect_uris: ['http://localhost:3000/api/v1/auth/oidc/callback'],
      },
      expect.any(Function),
    );
    expect(service.getConfiguration()).toBeDefined();
    expect(service.getScopeString()).toBe('openid email');
    expect(service.getAuthorizationParams()).toEqual({
      uiLocales: 'en',
      vtr: undefined,
    });
    expect(service.getRedirectUri()).toBe(
      'http://localhost:3000/api/v1/auth/oidc/callback',
    );
    expect(service.getIssuer()).toBe('https://oidc.integration.account.gov.uk');
  });

  it('onModuleInit delegates to initialize', async () => {
    await createModule({ enabled: false });
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(discoveryMock).not.toHaveBeenCalled();
  });
});
