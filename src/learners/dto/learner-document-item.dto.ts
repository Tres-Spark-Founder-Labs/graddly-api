import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { LearnerDocumentType } from '../enums/learner-document-type.enum.js';

export class LearnerDocumentItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: LearnerDocumentType })
  type!: LearnerDocumentType;

  @ApiProperty({ description: 'Human-readable document title.' })
  title!: string;

  @ApiProperty({
    description: 'Sortable document timestamp (ISO 8601).',
  })
  documentAt!: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'S3 storage key when the document is stored in object storage.',
  })
  storageKey!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'External URL for link-type evidence (no presigned download).',
  })
  externalUrl!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Presigned download URL when storageKey is set.',
  })
  downloadUrl?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Presigned URL expiry when downloadUrl is present.',
  })
  downloadExpiresAt?: string | null;
}
