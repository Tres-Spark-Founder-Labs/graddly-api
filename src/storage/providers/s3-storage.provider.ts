import {
  PutObjectCommand,
  S3Client,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  IPresignedDownloadRequest,
  IPresignedDownloadResult,
  IPresignedUploadRequest,
  IPresignedUploadResult,
  IPutObjectRequest,
  IStorageProvider,
} from '../interfaces/storage-provider.interface.js';

@Injectable()
export class S3StorageProvider implements IStorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    const region = this.config.get<string>('app.storage.region', 'eu-west-2');
    const accessKeyId = this.config.get<string>('app.storage.accessKeyId');
    const secretAccessKey = this.config.get<string>(
      'app.storage.secretAccessKey',
    );

    this.client = new S3Client({
      region,
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey }
          : undefined,
      /**
       * Without this, every presigned upload URL is born broken.
       *
       * From v3.729 the SDK defaults to `WHEN_SUPPORTED`, which attaches a
       * CRC32 of the request payload. A presign has no payload, so what gets
       * baked into the URL is `x-amz-checksum-crc32=AAAAAA==` -- the CRC32 of
       * zero bytes. The browser then PUTs the actual file, S3 checksums it,
       * the two disagree, and the upload is rejected for every file that is
       * not empty.
       *
       * `WHEN_REQUIRED` keeps checksums for the operations that mandate them
       * and leaves the presigned PUT alone. Verified by inspecting the signed
       * URL's query string, which is what the spec below asserts.
       */
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
    this.bucket = this.config.get<string>('app.storage.bucket', '');
  }

  async createUploadUrl(
    request: IPresignedUploadRequest,
  ): Promise<IPresignedUploadResult> {
    /* eslint-disable @typescript-eslint/naming-convention -- AWS SDK input shape */
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: request.key,
      ContentType: request.contentType,
      ContentLength: request.contentLength,
    });
    /* eslint-enable @typescript-eslint/naming-convention */

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: request.expiresInSeconds,
    });

    return {
      uploadUrl,
      expiresAt: new Date(Date.now() + request.expiresInSeconds * 1000),
    };
  }

  async createDownloadUrl(
    request: IPresignedDownloadRequest,
  ): Promise<IPresignedDownloadResult> {
    /* eslint-disable @typescript-eslint/naming-convention -- AWS SDK input shape */
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: request.key,
    });
    /* eslint-enable @typescript-eslint/naming-convention */

    const downloadUrl = await getSignedUrl(this.client, command, {
      expiresIn: request.expiresInSeconds,
    });

    return {
      downloadUrl,
      expiresAt: new Date(Date.now() + request.expiresInSeconds * 1000),
    };
  }

  async putObject(request: IPutObjectRequest): Promise<void> {
    /* eslint-disable @typescript-eslint/naming-convention -- AWS SDK input shape */
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: request.key,
        Body: request.body,
        ContentType: request.contentType,
      }),
    );
    /* eslint-enable @typescript-eslint/naming-convention */
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    /* eslint-disable @typescript-eslint/naming-convention -- AWS SDK input shape */
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
    /* eslint-enable @typescript-eslint/naming-convention */

    const body = response.Body;
    if (!body) {
      throw new Error(`Empty S3 object body for key ${key}`);
    }

    const bytes = await body.transformToByteArray();
    return Buffer.from(bytes);
  }
}
