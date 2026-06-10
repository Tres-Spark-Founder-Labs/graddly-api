import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IlrSubmissionStatus } from '../enums/ilr-submission-status.enum.js';

export class IlrSubmissionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organisationId!: string;

  @ApiProperty({ format: 'uuid' })
  ilrLearnerRecordId!: string;

  @ApiProperty({ example: 1 })
  attempt!: number;

  @ApiProperty({ example: false })
  isAmendment!: boolean;

  @ApiProperty({ format: 'uuid', nullable: true })
  amendsSubmissionId!: string | null;

  @ApiProperty({
    enum: IlrSubmissionStatus,
    description:
      'Submission lifecycle: queued (accepted, awaiting worker) → processing → submitted | failed. Poll GET /ilr/submissions/:id until terminal status.',
    example: IlrSubmissionStatus.QUEUED,
  })
  status!: IlrSubmissionStatus;

  @ApiProperty({
    nullable: true,
    example: 'ESFA-TEST-REF-001',
    description: 'Populated when status is submitted.',
  })
  esfaReference!: string | null;

  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    description: 'ESFA receipt JSON; populated when status is submitted.',
    example: { status: 'accepted', submissionId: 'ESFA-TEST-REF-001' },
  })
  receipt!: Record<string, unknown> | null;

  @ApiProperty({
    nullable: true,
    description: 'ISO timestamp when ESFA accepted the submission.',
  })
  submittedAt!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'ISO timestamp when the submission failed terminally.',
  })
  failedAt!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Last worker or ESFA error message when status is failed.',
  })
  lastError!: string | null;

  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    description:
      'Audit copy of the outbound payload. format=ilr-xml includes the generated XML string.',
    example: {
      format: 'ilr-xml',
      ukprn: '10012345',
      collectionPeriod: '2025-10',
    },
  })
  requestPayload!: Record<string, unknown> | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'User who requested submit/amend; used for notifications.',
  })
  requestedByUserId!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}
