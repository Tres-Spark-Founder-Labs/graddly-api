import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { IlrEsfaHttpClient } from './ilr-esfa-http.client.js';
import { IlrEsfaOAuthService } from './ilr-esfa-oauth.service.js';
import { buildSampleFieldMap } from './testing/ilr-test-fixtures.js';

describe('IlrEsfaHttpClient', () => {
  let client: IlrEsfaHttpClient;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        IlrEsfaHttpClient,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: unknown) => {
              switch (key) {
                case 'app.ilr.esfa.baseUrl':
                  return 'https://ilr.example.com';
                case 'app.ilr.esfa.submitPath':
                  return '/api/v1/ilr/submit';
                case 'app.ilr.esfa.timeoutMs':
                  return 5000;
                default:
                  return fallback;
              }
            }),
          },
        },
        {
          provide: IlrEsfaOAuthService,
          useValue: {
            getAccessToken: jest.fn().mockResolvedValue('token-1'),
          },
        },
      ],
    }).compile();

    client = moduleRef.get(IlrEsfaHttpClient);
    jest.restoreAllMocks();
  });

  it('maps flexible success response keys', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ submissionId: 'ESFA-123', status: 'accepted' }),
          { status: 200 },
        ),
      );

    const result = await client.submit({
      organisationId: 'org-1',
      ukprn: '10012345',
      collectionPeriod: '2025-10',
      academicYear: '2025-26',
      fields: buildSampleFieldMap(),
      isAmendment: false,
      learnerRecordId: 'record-1',
    });

    expect(result.esfaReference).toBe('ESFA-123');
  });

  it('throws on non-OK response', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('bad request', { status: 400 }));

    await expect(
      client.submit({
        organisationId: 'org-1',
        ukprn: '10012345',
        collectionPeriod: '2025-10',
        academicYear: '2025-26',
        fields: buildSampleFieldMap(),
        isAmendment: false,
        learnerRecordId: 'record-1',
      }),
    ).rejects.toThrow('ILR ESFA submit request failed (400)');
  });
});
