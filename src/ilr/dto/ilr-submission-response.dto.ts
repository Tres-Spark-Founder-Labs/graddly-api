import { ApiProperty } from '@nestjs/swagger';

import { IlrSubmissionStatus } from '../enums/ilr-submission-status.enum.js';

export class IlrSubmissionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organisationId!: string;

  @ApiProperty({ format: 'uuid' })
  ilrLearnerRecordId!: string;

  @ApiProperty()
  attempt!: number;

  @ApiProperty()
  isAmendment!: boolean;

  @ApiProperty({ format: 'uuid', nullable: true })
  amendsSubmissionId!: string | null;

  @ApiProperty({ enum: IlrSubmissionStatus })
  status!: IlrSubmissionStatus;

  @ApiProperty({ nullable: true })
  esfaReference!: string | null;

  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  receipt!: Record<string, unknown> | null;

  @ApiProperty({ nullable: true })
  submittedAt!: string | null;

  @ApiProperty({ nullable: true })
  failedAt!: string | null;

  @ApiProperty({ nullable: true })
  lastError!: string | null;

  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  requestPayload!: Record<string, unknown> | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}
