import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { IlrEsfaOAuthService } from './ilr-esfa-oauth.service.js';

describe('IlrEsfaOAuthService', () => {
  let service: IlrEsfaOAuthService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        IlrEsfaOAuthService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: unknown) => {
              switch (key) {
                case 'app.ilr.esfa.tokenUrl':
                  return 'https://ilr.example.com/oauth/token';
                case 'app.ilr.esfa.clientId':
                  return 'client-id';
                case 'app.ilr.esfa.clientSecret':
                  return 'client-secret';
                case 'app.ilr.esfa.scope':
                  return 'ilr.submit';
                case 'app.ilr.esfa.timeoutMs':
                  return 5000;
                default:
                  return fallback;
              }
            }),
          },
        },
      ],
    }).compile();
    service = moduleRef.get(IlrEsfaOAuthService);
    jest.restoreAllMocks();
  });

  it('fetches and caches access token', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          '{"access_token":"abc","token_type":"Bearer","expires_in":300}',
          { status: 200 },
        ),
      );

    const first = await service.getAccessToken();
    const second = await service.getAccessToken();

    expect(first).toBe('abc');
    expect(second).toBe('abc');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
