import { ApiProperty } from '@nestjs/swagger';

import { QipActionStatus } from '../enums/qip-action-status.enum.js';

export class QipActionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organisationId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({
    format: 'uuid',
    description: 'Staff owner user id.',
  })
  assignedOwnerUserId!: string;

  /**
   * The same pairing `enrolments` already ships as `apprenticeUserDisplayName`
   * and its siblings: the id for the form, the name for the screen.
   *
   * Without it every consumer of this endpoint has two bad options — print the
   * uuid, or fetch the whole organisation's users to translate one id. The SAR
   * export already resolves these names for exactly that reason
   * (`qip-actions.service.ts`, "an inspector cannot chase an identifier"); the
   * list endpoint was the half that never got it.
   *
   * Null only when the owner row has gone (a deleted account), which the UI
   * should render as "Unassigned" rather than blank.
   */
  @ApiProperty({
    nullable: true,
    example: 'Sarah Hutchinson',
    description: 'Owner name for display. Null when the user no longer exists.',
  })
  assignedOwnerDisplayName!: string | null;

  @ApiProperty({ format: 'date' })
  targetCompletionDate!: string;

  @ApiProperty({
    description: 'Linked EIF criterion slug.',
    example: 'safeguarding',
  })
  eifCriterionSlug!: string;

  @ApiProperty({ nullable: true })
  evidenceNotes!: string | null;

  @ApiProperty({ nullable: true, type: [String] })
  evidenceAttachmentKeys!: string[] | null;

  @ApiProperty({ enum: QipActionStatus })
  status!: QipActionStatus;

  @ApiProperty({
    description:
      'Derived on read: true when targetCompletionDate is before today and status is not completed.',
  })
  isOverdue!: boolean;
}
