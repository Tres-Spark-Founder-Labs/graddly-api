import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { DasApiActivityService } from './das-api-activity.service.js';
import { DasOAuthService } from './das-oauth.service.js';

describe('DasOAuthService', () => {
  let service: DasOAuthService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DasOAuthService,
        {
          provide: DasApiActivityService,
          useValue: { record: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: unknown) => {
              switch (key) {
                case 'app.das.tokenUrl':
                  return 'https://das.example.com/oauth/token';
                case 'app.das.clientId':
                  return 'client-id';
                case 'app.das.clientSecret':
                  return 'client-secret';
                case 'app.das.scope':
                  return 'scope.read';
                case 'app.das.timeoutMs':
                  return 5000;
                default:
                  return fallback;
              }
            }),
          },
        },
      ],
    }).compile();
    service = moduleRef.get(DasOAuthService);
    jest.restoreAllMocks();
  });

  it('fetches and caches access token', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        '{"access_token":"abc","token_type":"Bearer","expires_in":300}',
        {
          status: 200,
        },
      ),
    );

    const first = await service.getAccessToken();
    const second = await service.getAccessToken();

    expect(first).toBe('abc');
    expect(second).toBe('abc');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
