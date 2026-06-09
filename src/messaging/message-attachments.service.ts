import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { StorageObjectCategory } from '../storage/enums/storage-object-category.enum.js';
import { StorageKeyBuilder } from '../storage/storage-key.builder.js';
import { ALLOWED_MIME_TYPES } from '../storage/storage.constants.js';
import { StorageService } from '../storage/storage.service.js';

import { CreateMessageAttachmentUploadUrlDto } from './dto/create-message.dto.js';
import { MAX_MESSAGE_ATTACHMENT_BYTES } from './messaging.constants.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import type { PresignedUploadResponseDto } from '../storage/dto/create-presigned-upload.dto.js';

@Injectable()
export class MessageAttachmentsService {
  constructor(
    private readonly storageService: StorageService,
    private readonly keyBuilder: StorageKeyBuilder,
  ) {}

  async createUploadUrl(
    user: AuthenticatedUser,
    dto: CreateMessageAttachmentUploadUrlDto,
  ): Promise<PresignedUploadResponseDto> {
    if (dto.contentLength > MAX_MESSAGE_ATTACHMENT_BYTES) {
      throw new BadRequestException(
        `Attachment exceeds the maximum of ${MAX_MESSAGE_ATTACHMENT_BYTES} bytes (10 MB)`,
      );
    }

    if (
      !ALLOWED_MIME_TYPES.includes(
        dto.contentType as (typeof ALLOWED_MIME_TYPES)[number],
      )
    ) {
      throw new BadRequestException(
        `Content type "${dto.contentType}" is not allowed for upload`,
      );
    }

    return this.storageService.createUploadUrl(user.organisationId!, {
      filename: dto.filename,
      contentType: dto.contentType,
      contentLength: dto.contentLength,
      category: StorageObjectCategory.ATTACHMENT,
      learnerId: dto.apprenticeId,
    });
  }

  assertAttachmentStorageKey(
    organisationId: string,
    apprenticeId: string,
    storageKey: string,
  ): void {
    if (!this.keyBuilder.belongsToOrganisation(storageKey, organisationId)) {
      throw new ForbiddenException('Storage key is not in this organisation');
    }

    const expectedPrefix = `orgs/${organisationId}/learners/${apprenticeId}/${StorageObjectCategory.ATTACHMENT}/`;
    if (!storageKey.startsWith(expectedPrefix)) {
      throw new BadRequestException(
        'Storage key must be a messaging attachment for this apprentice',
      );
    }
  }

  assertAttachmentMetadata(contentType: string, contentLength: number): void {
    if (contentLength > MAX_MESSAGE_ATTACHMENT_BYTES) {
      throw new BadRequestException(
        `Attachment exceeds the maximum of ${MAX_MESSAGE_ATTACHMENT_BYTES} bytes (10 MB)`,
      );
    }

    if (
      !ALLOWED_MIME_TYPES.includes(
        contentType as (typeof ALLOWED_MIME_TYPES)[number],
      )
    ) {
      throw new BadRequestException(
        `Content type "${contentType}" is not allowed for upload`,
      );
    }
  }
}
