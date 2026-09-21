import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  ValidateNested,
} from 'class-validator';

import { NotificationChannel } from '../enums/notification-channel.enum.js';
import { NotificationType } from '../enums/notification-type.enum.js';

/** One channel of one type, as the user has it. */
export class NotificationChannelPreferenceDto {
  @ApiProperty({ enum: NotificationChannel })
  channel!: NotificationChannel;

  @ApiProperty({
    description: 'Whether this channel is on. With no stored choice, true.',
  })
  enabled!: boolean;

  @ApiProperty({
    description:
      'Whether PATCH /notifications/preferences may change this pair. True ' +
      'only for email on a type the platform emails. In-app is never ' +
      'configurable (F3.4.3 AC1: the centre lists every notification); the ' +
      'OTJ digest keeps its own endpoint, /notifications/preferences/digest.',
  })
  configurable!: boolean;
}

/** One notification type, labelled by the API so no portal keeps a copy. */
export class NotificationTypePreferencesDto {
  @ApiProperty({ enum: NotificationType })
  type!: NotificationType;

  @ApiProperty({ example: 'Review reminders' })
  label!: string;

  @ApiProperty({ type: [NotificationChannelPreferenceDto] })
  channels!: NotificationChannelPreferenceDto[];
}

/** GET /notifications/preferences — every (channel, type) pair. */
export class NotificationPreferencesResponseDto {
  @ApiProperty({ type: [NotificationTypePreferencesDto] })
  types!: NotificationTypePreferencesDto[];
}

/** One requested change. */
export class UpdateNotificationPreferenceItemDto {
  @ApiProperty({
    enum: NotificationChannel,
    example: NotificationChannel.EMAIL,
  })
  @IsEnum(NotificationChannel)
  channel!: NotificationChannel;

  @ApiProperty({ enum: NotificationType, example: NotificationType.REVIEW })
  @IsEnum(NotificationType)
  type!: NotificationType;

  @ApiProperty({ example: false })
  @IsBoolean()
  enabled!: boolean;
}

/**
 * PATCH /notifications/preferences — the user's own preferences, per user
 * rather than per organisation (migration 1781100000057 says why). Each pair
 * must be configurable, and may appear once.
 */
export class UpdateNotificationPreferencesDto {
  @ApiProperty({ type: [UpdateNotificationPreferenceItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => UpdateNotificationPreferenceItemDto)
  preferences!: UpdateNotificationPreferenceItemDto[];
}
