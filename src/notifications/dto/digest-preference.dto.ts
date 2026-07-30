import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

import { DigestFrequency } from '../enums/digest-frequency.enum.js';
import { NotificationType } from '../enums/notification-type.enum.js';

/** F1.2.3 AC7 — request body for changing digest cadence. */
export class UpdateDigestPreferenceDto {
  @ApiProperty({
    enum: DigestFrequency,
    description:
      'daily sends every morning, weekly sends on Monday, off stops delivery.',
  })
  @IsEnum(DigestFrequency)
  frequency!: DigestFrequency;
}

export class DigestPreferenceResponseDto {
  @ApiProperty({ enum: NotificationType })
  type!: NotificationType;

  @ApiProperty({ enum: DigestFrequency })
  frequency!: DigestFrequency;
}
