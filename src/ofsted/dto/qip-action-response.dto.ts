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
