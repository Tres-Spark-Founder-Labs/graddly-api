import { ApiProperty } from '@nestjs/swagger';

import { EnrolmentPushStatus } from '../enums/enrolment-push-status.enum.js';
import { EnrolmentPushTrigger } from '../enums/enrolment-push-trigger.enum.js';

export class EnrolmentSubmissionPushResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organisationId!: string;

  @ApiProperty({ format: 'uuid' })
  enrolmentId!: string;

  @ApiProperty({ format: 'uuid' })
  apprenticeId!: string;

  @ApiProperty({ format: 'uuid' })
  ilrLearnerRecordId!: string;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Set when push was triggered after ILR ESFA submit',
  })
  ilrSubmissionId!: string | null;

  @ApiProperty({ enum: EnrolmentPushTrigger })
  trigger!: EnrolmentPushTrigger;

  @ApiProperty({
    enum: EnrolmentPushStatus,
    description:
      'Lifecycle: queued → processing → delivered | failed. Poll this endpoint after ILR create/submit.',
  })
  status!: EnrolmentPushStatus;

  @ApiProperty({ example: 1 })
  attempts!: number;

  @ApiProperty({
    nullable: true,
    example: 'DAS enrolment submission path configuration missing',
  })
  lastError!: string | null;

  @ApiProperty({
    nullable: true,
    example: 'DAS-ENR-2026-001',
    description: 'DAS reference returned on successful delivery',
  })
  dasReference!: string | null;

  @ApiProperty({
    nullable: true,
    format: 'date-time',
    description: 'Populated when status is delivered',
  })
  deliveredAt!: string | null;
}
