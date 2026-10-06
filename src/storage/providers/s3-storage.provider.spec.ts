/* eslint-disable @typescript-eslint/naming-convention -- AWS SDK mock class names */
import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { S3StorageProvider } from './s3-storage.provider.js';

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(),
  PutObjectCommand: jest
    .fn()
    .mockImplementation((input: unknown) => ({ input })),
  GetObjectCommand: jest
    .fn()
    .mockImplementation((input: unknown) => ({ input })),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

describe('S3StorageProvider', () => {
  let provider: S3StorageProvider;
  const getSignedUrlMock = jest.mocked(getSignedUrl);

  beforeEach(async () => {
    jest.clearAllMocks();
    getSignedUrlMock.mockResolvedValue('https://signed.example/upload');

    const configGet = jest.fn((key: string, fallback?: string) => {
      const values: Record<string, string> = {
        ['app.storage.region']: 'eu-west-2',
        ['app.storage.bucket']: 'graddly-test',
        ['app.storage.accessKeyId']: 'key',
        ['app.storage.secretAccessKey']: 'secret',
      };
      return values[key] ?? fallback;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        S3StorageProvider,
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();

    provider = module.get(S3StorageProvider);
  });

  /**
   * Regression guard. The SDK's default checksum mode bakes the CRC32 of an
   * empty payload into every presigned PUT, so S3 rejects the real file when
   * the browser sends it -- an upload path that cannot work for any non-empty
   * file, and which fails at S3 rather than anywhere we would see it.
   */
  it('turns off the default payload checksum, which presigned PUTs cannot satisfy', () => {
    expect(jest.mocked(S3Client).mock.calls[0]?.[0]).toMatchObject({
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  });

  it('presigns upload URLs', async () => {
    const result = await provider.createUploadUrl({
      key: 'orgs/a/file.pdf',
      contentType: 'application/pdf',
      contentLength: 1000,
      expiresInSeconds: 900,
    });

    expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
    expect(getSignedUrlMock.mock.calls[0]?.[2]).toEqual({ expiresIn: 900 });
    expect(result.uploadUrl).toBe('https://signed.example/upload');
  });
});
