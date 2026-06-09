import { ApiProperty } from '@nestjs/swagger';

import { EvidencePackJobStatus } from '../enums/evidence-pack-job-status.enum.js';

export class EvidencePackJobResponseDto {
  @ApiProperty({ format: 'uuid' })
  jobId!: string;

  @ApiProperty({ enum: EvidencePackJobStatus })
  status!: EvidencePackJobStatus;

  @ApiProperty({ nullable: true })
  outputKey!: string | null;

  @ApiProperty({ nullable: true })
  errorMessage!: string | null;

  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  manifest!: Record<string, unknown> | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ nullable: true })
  completedAt!: string | null;

  @ApiProperty({ nullable: true })
  downloadUrl?: string | null;

  @ApiProperty({ nullable: true })
  downloadExpiresAt?: string | null;
}
