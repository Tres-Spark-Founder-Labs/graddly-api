import { ApiProperty } from '@nestjs/swagger';

import { MessageThreadParty } from '../enums/message-thread-party.enum.js';

export class MessageThreadResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organisationId!: string;

  @ApiProperty({ format: 'uuid' })
  enrolmentId!: string;

  @ApiProperty({ format: 'uuid' })
  apprenticeId!: string;

  @ApiProperty({ enum: MessageThreadParty })
  counterpartyParty!: MessageThreadParty;

  @ApiProperty({ format: 'uuid' })
  apprenticeUserId!: string;

  @ApiProperty({ format: 'uuid' })
  counterpartyUserId!: string;

  @ApiProperty({
    nullable: true,
    description:
      'Set when the enrolment is completed; thread becomes read-only',
  })
  archivedAt!: string | null;

  @ApiProperty({
    description: 'Unread messages for the current user in this thread',
    example: 2,
  })
  unreadCount!: number;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}
