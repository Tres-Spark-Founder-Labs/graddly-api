import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  CreatePresignedUploadDto,
  PresignedUploadResponseDto,
} from './dto/create-presigned-upload.dto.js';
import { StorageKeyBuilder } from './storage-key.builder.js';
import { StorageValidationService } from './storage-validation.service.js';
import { STORAGE_PROVIDER } from './storage.constants.js';

import type {
  CreatePresignedDownloadDto,
  PresignedDownloadResponseDto,
} from './dto/create-presigned-download.dto.js';
import type { IStorageProvider } from './interfaces/storage-provider.interface.js';

@Injectable()
export class StorageService {
  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: IStorageProvider,
    private readonly config: ConfigService,
    private readonly keyBuilder: StorageKeyBuilder,
    private readonly validation: StorageValidationService,
  ) {}

  async createUploadUrl(
    organisationId: string,
    dto: CreatePresignedUploadDto,
  ): Promise<PresignedUploadResponseDto> {
    this.validation.assertUploadAllowed(dto.contentType, dto.contentLength);

    const key = this.keyBuilder.build({
      organisationId,
      category: dto.category,
      filename: dto.filename,
      learnerId: dto.learnerId,
    });

    const expiresInSeconds = this.config.get<number>(
      'app.storage.presignUploadTtlSeconds',
      900,
    );

    const result = await this.storage.createUploadUrl({
      key,
      contentType: dto.contentType,
      contentLength: dto.contentLength,
      expiresInSeconds,
    });

    return {
      key,
      uploadUrl: result.uploadUrl,
      expiresAt: result.expiresAt,
    };
  }

  /**
   * `options.expiresInSeconds` overrides the configured download TTL for a
   * link that has to outlive a request — the emailed EPA pack link (F3.3.4
   * AC5). Everything served to a signed-in browser keeps the short default.
   */
  async createDownloadUrl(
    organisationId: string,
    dto: CreatePresignedDownloadDto,
    options: { expiresInSeconds?: number } = {},
  ): Promise<PresignedDownloadResponseDto> {
    if (!this.keyBuilder.belongsToOrganisation(dto.key, organisationId)) {
      throw new ForbiddenException('Access denied for this object key');
    }

    const expiresInSeconds =
      options.expiresInSeconds ??
      this.config.get<number>('app.storage.presignDownloadTtlSeconds', 300);

    const result = await this.storage.createDownloadUrl({
      key: dto.key,
      expiresInSeconds,
    });

    return {
      downloadUrl: result.downloadUrl,
      expiresAt: result.expiresAt,
    };
  }

  async putObject(
    organisationId: string,
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    if (!this.keyBuilder.belongsToOrganisation(key, organisationId)) {
      throw new ForbiddenException('Access denied for this object key');
    }

    await this.storage.putObject({ key, body, contentType });
  }

  async getObjectBuffer(organisationId: string, key: string): Promise<Buffer> {
    if (!this.keyBuilder.belongsToOrganisation(key, organisationId)) {
      throw new ForbiddenException('Access denied for this object key');
    }

    return this.storage.getObjectBuffer(key);
  }
}
