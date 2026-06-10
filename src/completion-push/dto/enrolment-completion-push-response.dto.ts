import { ApiProperty } from '@nestjs/swagger';

import { CompletionPushStatus } from '../enums/completion-push-status.enum.js';
import { CompletionPushTrigger } from '../enums/completion-push-trigger.enum.js';

export class EnrolmentCompletionPushResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organisationId!: string;

  @ApiProperty({ format: 'uuid' })
  enrolmentId!: string;

  @ApiProperty({ format: 'uuid' })
  apprenticeId!: string;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Set when push was triggered after EPA outcome recording',
  })
  epaOutcomeId!: string | null;

  @ApiProperty({ enum: CompletionPushTrigger })
  trigger!: CompletionPushTrigger;

  @ApiProperty({
    enum: CompletionPushStatus,
    description:
      'Lifecycle: queued → processing → delivered | failed. Poll after enrolment complete or EPA outcome.',
  })
  status!: CompletionPushStatus;

  @ApiProperty({ example: 1 })
  attempts!: number;

  @ApiProperty({ nullable: true })
  lastError!: string | null;

  @ApiProperty({ nullable: true, example: 'DAS-CMP-2026-001' })
  dasReference!: string | null;

  @ApiProperty({ nullable: true, format: 'date-time' })
  deliveredAt!: string | null;
}
