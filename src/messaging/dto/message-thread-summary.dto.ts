import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { MessageThreadParty } from '../enums/message-thread-party.enum.js';

/**
 * A thread as it appears *inside another screen* — the learner profile's
 * communication panel (F2.2.4 AC5), rather than the messaging inbox.
 *
 * The inbox has `MessageThreadResponseDto`, which describes the thread's
 * plumbing: which organisation, which enrolment, which two user ids. That is
 * the right shape for a screen whose whole job is messaging.
 *
 * It is the wrong shape for a panel on someone else's page. A tutor opening a
 * learner profile wants to know *"has this learner been in touch, who with,
 * and about what"* — and the plumbing DTO answers none of those without a
 * second and third round trip to resolve names and fetch the latest message.
 * So this one carries the answers: who the counterparty is by name, how many
 * messages exist, and enough of the last one to recognise the conversation.
 */
export class MessageThreadSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: MessageThreadParty })
  counterpartyParty!: MessageThreadParty;

  @ApiProperty({ format: 'uuid' })
  counterpartyUserId!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Null when the counterparty user record has been removed.',
  })
  counterpartyName!: string | null;

  @ApiProperty({ description: 'Messages in the thread, read or unread.' })
  messageCount!: number;

  @ApiProperty({ description: 'Unread messages for the requesting user.' })
  unreadCount!: number;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  lastMessageAt!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'First 160 characters of the most recent message. Enough to recognise ' +
      'the conversation; the full thread is at GET /messaging/threads/:id/messages.',
  })
  lastMessagePreview!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  lastMessageSenderUserId!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  archivedAt!: string | null;
}
