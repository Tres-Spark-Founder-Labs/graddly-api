import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { StorageObjectCategory } from './enums/storage-object-category.enum.js';
import { StorageKeyBuilder } from './storage-key.builder.js';
import { StorageValidationService } from './storage-validation.service.js';
import { STORAGE_PROVIDER } from './storage.constants.js';
import { StorageService } from './storage.service.js';

import type { IStorageProvider } from './interfaces/storage-provider.interface.js';

describe('StorageService', () => {
  let service: StorageService;

  const createUploadUrlMock = jest.fn();
  const createDownloadUrlMock = jest.fn();
  const putObjectMock = jest.fn();
  const getObjectBufferMock = jest.fn();

  const storage: IStorageProvider = {
    createUploadUrl: createUploadUrlMock,
    createDownloadUrl: createDownloadUrlMock,
    putObject: putObjectMock,
    getObjectBuffer: getObjectBufferMock,
  };

  const config = {
    get: jest.fn((key: string, fallback?: number) => {
      if (key === 'app.storage.presignUploadTtlSeconds') return 900;
      if (key === 'app.storage.presignDownloadTtlSeconds') return 300;
      return fallback;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    createUploadUrlMock.mockResolvedValue({
      uploadUrl: 'https://example.com/upload',
      expiresAt: new Date('2026-01-01T00:15:00.000Z'),
    });
    createDownloadUrlMock.mockResolvedValue({
      downloadUrl: 'https://example.com/download',
      expiresAt: new Date('2026-01-01T00:05:00.000Z'),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        StorageKeyBuilder,
        StorageValidationService,
        { provide: STORAGE_PROVIDER, useValue: storage },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get(StorageService);
  });

  it('creates upload URLs under the active organisation', async () => {
    const orgId = '11111111-1111-1111-1111-111111111111';
    const result = await service.createUploadUrl(orgId, {
      filename: 'doc.pdf',
      contentType: 'application/pdf',
      contentLength: 1000,
      category: StorageObjectCategory.EVIDENCE,
    });

    expect(result.key).toMatch(
      new RegExp(`^orgs/${orgId}/evidence/[0-9a-f-]+/doc\\.pdf$`),
    );
    expect(result.uploadUrl).toBe('https://example.com/upload');
    expect(createUploadUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'application/pdf',
        contentLength: 1000,
      }),
    );
  });

  it('creates download URLs for keys in the same org', async () => {
    const orgId = '11111111-1111-1111-1111-111111111111';
    const key = `orgs/${orgId}/general/obj/file.pdf`;

    const result = await service.createDownloadUrl(orgId, { key });

    expect(result.downloadUrl).toBe('https://example.com/download');
    expect(createDownloadUrlMock).toHaveBeenCalledWith({
      key,
      expiresInSeconds: 300,
    });
  });

  it('denies download for keys outside the organisation', async () => {
    await expect(
      service.createDownloadUrl('11111111-1111-1111-1111-111111111111', {
        key: 'orgs/99999999-9999-9999-9999-999999999999/general/obj/file.pdf',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('puts object buffer for keys in the same org', async () => {
    const orgId = '11111111-1111-1111-1111-111111111111';
    const key = `orgs/${orgId}/export/obj/file.pdf`;
    putObjectMock.mockResolvedValue(undefined);

    await service.putObject(orgId, key, Buffer.from('pdf'), 'application/pdf');

    expect(putObjectMock).toHaveBeenCalledWith({
      key,
      body: Buffer.from('pdf'),
      contentType: 'application/pdf',
    });
  });

  it('reads object buffer for keys in the same org', async () => {
    const orgId = '11111111-1111-1111-1111-111111111111';
    const key = `orgs/${orgId}/general/obj/file.pdf`;
    getObjectBufferMock.mockResolvedValue(Buffer.from('bytes'));

    const buffer = await service.getObjectBuffer(orgId, key);

    expect(buffer).toEqual(Buffer.from('bytes'));
    expect(getObjectBufferMock).toHaveBeenCalledWith(key);
  });
});
