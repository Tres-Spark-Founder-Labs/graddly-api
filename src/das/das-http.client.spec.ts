import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { DasHttpClient } from './das-http.client.js';
import { DasOAuthService } from './das-oauth.service.js';

describe('DasHttpClient', () => {
  let client: DasHttpClient;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DasHttpClient,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: unknown) => {
              switch (key) {
                case 'app.das.baseUrl':
                  return 'https://das.example.com';
                case 'app.das.levyBalancePath':
                  return '/api/levy/balance';
                case 'app.das.enrolmentSubmitPath':
                  return '/api/apprenticeships/enrolments';
                case 'app.das.completionNotifyPath':
                  return '/api/apprenticeships/completions';
                case 'app.das.timeoutMs':
                  return 5000;
                default:
                  return fallback;
              }
            }),
          },
        },
        {
          provide: DasOAuthService,
          useValue: {
            getAccessToken: jest.fn().mockResolvedValue('token-1'),
          },
        },
      ],
    }).compile();

    client = moduleRef.get(DasHttpClient);
    jest.restoreAllMocks();
  });

  it('maps levy payload fields', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          accountId: 'das-1',
          levyBalance: 123.45,
          currency: 'GBP',
        }),
        { status: 200 },
      ),
    );

    const result = await client.fetchLevyBalance('12345678');
    expect(result.accountId).toBe('das-1');
    expect(result.balance).toBe('123.45');
    expect(result.currency).toBe('GBP');
  });

  it('posts enrolment submission as JSON', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          enrolmentReference: 'DAS-ENR-1',
          status: 'accepted',
        }),
        { status: 200 },
      ),
    );

    const result = await client.submitEnrolment({
      ukprn: '10012345',
      learnerRef: 'LRN-1',
      standardCode: 'ST0001',
      givenNames: 'Alex',
      familyName: 'Taylor',
      plannedStartDate: '2025-09-01',
      plannedEndDate: '2027-09-01',
    });

    expect(result.reference).toBe('DAS-ENR-1');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe(
      'application/json',
    );
    const body =
      typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
    expect(JSON.parse(body)).toMatchObject({
      learnerRef: 'LRN-1',
      standardCode: 'ST0001',
    });
  });

  it('posts completion notification as JSON', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          completionReference: 'DAS-CMP-1',
          completionStatus: 'accepted',
        }),
        { status: 200 },
      ),
    );

    const result = await client.notifyCompletion({
      learnerRef: 'LRN-1',
      completionDate: '2026-06-01',
      epaOutcome: 'pass',
    });

    expect(result.reference).toBe('DAS-CMP-1');
  });
});
