import { ApiProperty } from '@nestjs/swagger';

import { EvidencePackJobStatus } from '../enums/evidence-pack-job-status.enum.js';

export class EvidencePackJobResponseDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Job id; use for polling GET /ofsted/evidence-packs/:id.',
  })
  jobId!: string;

  @ApiProperty({ enum: EvidencePackJobStatus })
  status!: EvidencePackJobStatus;

  @ApiProperty({
    nullable: true,
    description: 'Storage export key when completed.',
  })
  outputKey!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Failure reason when status is failed.',
  })
  errorMessage!: string | null;

  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    description: 'File counts per EIF theme folder (and custom) after build.',
  })
  manifest!: Record<string, unknown> | null;

  @ApiProperty({ description: 'Job creation time (ISO 8601).' })
  createdAt!: string;

  @ApiProperty({
    nullable: true,
    description: 'Completion time when status is completed.',
  })
  completedAt!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Presigned download URL when status is completed.',
  })
  downloadUrl?: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Presigned URL expiry when status is completed.',
  })
  downloadExpiresAt?: string | null;
}
