import { ApiProperty } from '@nestjs/swagger';

import { EpaPackJobStatus } from '../enums/epa-pack-job-status.enum.js';

export class EpaPackJobResponseDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Job id; use for polling GET /portfolio/epa-pack-jobs/:id.',
  })
  jobId!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Enrolment the pack was built for.',
  })
  enrolmentId!: string;

  @ApiProperty({ enum: EpaPackJobStatus })
  status!: EpaPackJobStatus;

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
    description:
      'File counts per ZIP section (knowledge, skill, behaviour, reviews, commitment, summaries) after build.',
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
