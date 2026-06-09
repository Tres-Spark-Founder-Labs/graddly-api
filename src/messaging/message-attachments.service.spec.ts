import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { StorageObjectCategory } from '../storage/enums/storage-object-category.enum.js';
import { StorageKeyBuilder } from '../storage/storage-key.builder.js';
import { StorageService } from '../storage/storage.service.js';

import { MessageAttachmentsService } from './message-attachments.service.js';
import { MAX_MESSAGE_ATTACHMENT_BYTES } from './messaging.constants.js';

describe('MessageAttachmentsService', () => {
  const storageService = { createUploadUrl: jest.fn() };
  const keyBuilder = { belongsToOrganisation: jest.fn() };

  let service: MessageAttachmentsService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        MessageAttachmentsService,
        { provide: StorageService, useValue: storageService },
        { provide: StorageKeyBuilder, useValue: keyBuilder },
      ],
    }).compile();

    service = moduleRef.get(MessageAttachmentsService);
    jest.clearAllMocks();
    keyBuilder.belongsToOrganisation.mockReturnValue(true);
    storageService.createUploadUrl.mockResolvedValue({
      key: 'orgs/org-1/learners/a-1/attachment/id/file.pdf',
      uploadUrl: 'https://example.com/upload',
      expiresAt: '2026-01-01T00:00:00.000Z',
    });
  });

  const user = {
    id: 'u-1',
    organisationId: 'org-1',
    roles: ['member'],
  } as const;

  it('creates presigned upload URL for valid attachment', async () => {
    const result = await service.createUploadUrl(user, {
      apprenticeId: 'a-1',
      enrolmentId: 'e-1',
      filename: 'file.pdf',
      contentType: 'application/pdf',
      contentLength: 1024,
    });

    expect(result.uploadUrl).toBe('https://example.com/upload');
    expect(storageService.createUploadUrl).toHaveBeenCalledWith('org-1', {
      filename: 'file.pdf',
      contentType: 'application/pdf',
      contentLength: 1024,
      category: StorageObjectCategory.ATTACHMENT,
      learnerId: 'a-1',
    });
  });

  it('rejects attachments over 10 MB', async () => {
    await expect(
      service.createUploadUrl(user, {
        apprenticeId: 'a-1',
        enrolmentId: 'e-1',
        filename: 'big.pdf',
        contentType: 'application/pdf',
        contentLength: MAX_MESSAGE_ATTACHMENT_BYTES + 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validates attachment storage key prefix', () => {
    expect(() =>
      service.assertAttachmentStorageKey(
        'org-1',
        'a-1',
        'orgs/org-1/learners/a-1/attachment/x/file.pdf',
      ),
    ).not.toThrow();
  });

  it('rejects storage keys outside organisation', () => {
    keyBuilder.belongsToOrganisation.mockReturnValue(false);
    expect(() =>
      service.assertAttachmentStorageKey('org-1', 'a-1', 'bad-key'),
    ).toThrow(ForbiddenException);
  });
});
