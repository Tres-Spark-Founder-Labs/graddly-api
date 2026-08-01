import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

/**
 * F1.4.1 AC5 — the recipient list, replaced wholesale.
 *
 * A PUT of the full list rather than add/remove endpoints. Editing a
 * distribution list is a screen where somebody ticks boxes and saves, and
 * incremental endpoints would make that screen issue a diff — which goes
 * wrong when two admins edit at once and one of them silently re-adds
 * somebody the other just removed.
 */
export class SetReportSubscribersDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description:
      'User ids to receive the report. Must be members of the active ' +
      'organisation; the list is replaced, so an empty array turns delivery ' +
      'off.',
    example: ['3f7a1c8e-2b4d-4f6a-9c1e-8d5b2a7f4e30'],
  })
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  userIds!: string[];
}

export class ReportSubscriberDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ example: 'Ada Lovelace' })
  name!: string;

  @ApiProperty({ example: 'ada@example.com' })
  email!: string;

  @ApiProperty({
    nullable: true,
    format: 'date-time',
    description: 'Null until the first scheduled send reaches them.',
  })
  lastSentAt!: string | null;
}
