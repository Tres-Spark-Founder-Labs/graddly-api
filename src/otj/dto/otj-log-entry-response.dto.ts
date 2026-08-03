import { ApiProperty } from '@nestjs/swagger';

import { OtjActivityCategory } from '../enums/otj-activity-category.enum.js';
import { OtjLogStatus } from '../enums/otj-log-status.enum.js';

export class OtjLogEntryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organisationId!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Programme/course enrolment this OTJ session counts toward.',
  })
  enrolmentId!: string;

  @ApiProperty({ format: 'uuid' })
  apprenticeId!: string;

  /**
   * F1.2.3 AC1 — the approval queue lists the apprentice's name.
   *
   * Only the id was exposed before, so the employer queue rendered a
   * truncated UUID where a name belonged. Nullable because the apprentice
   * relation is not loaded on every read path.
   */
  @ApiProperty({ nullable: true })
  apprenticeName!: string | null;

  @ApiProperty({ format: 'date' })
  loggedDate!: string;

  /** When the apprentice submitted it for approval; null while still a draft. */
  @ApiProperty({ nullable: true, format: 'date-time' })
  submittedAt!: string | null;

  @ApiProperty({ maxLength: 80 })
  activityName!: string;

  @ApiProperty({
    enum: OtjActivityCategory,
    description: 'OTJ activity type (not the programme/course).',
  })
  category!: OtjActivityCategory;

  @ApiProperty()
  minutes!: number;

  @ApiProperty({ nullable: true })
  note!: string | null;

  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  evidence!: Record<string, unknown> | null;

  @ApiProperty({ enum: OtjLogStatus })
  status!: OtjLogStatus;

  @ApiProperty({ nullable: true })
  paceFlag!: string | null;

  @ApiProperty({ nullable: true })
  rejectionReason!: string | null;

  /**
   * F2.2.4 AC3 — a tutor flag, distinct from the approval decision. An
   * entry can be approved and flagged at once: the hours count, and the
   * tutor still wants a conversation about them.
   */
  @ApiProperty({ nullable: true, format: 'date-time' })
  flaggedAt!: string | null;

  @ApiProperty({ nullable: true })
  flagNote!: string | null;
}
