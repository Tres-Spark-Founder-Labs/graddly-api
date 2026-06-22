import { ApiProperty } from '@nestjs/swagger';

import { RetentionRunTrigger } from '../../data-retention/enums/retention-run-trigger.enum.js';

export class RetentionRunResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  ranAt!: string;

  @ApiProperty({
    enum: RetentionRunTrigger,
    example: RetentionRunTrigger.MANUAL,
  })
  triggeredBy!: RetentionRunTrigger;

  @ApiProperty({ example: 0 })
  auditLogsPurged!: number;

  @ApiProperty({ example: 0 })
  softDeletedPurged!: number;

  @ApiProperty({ example: 0 })
  oldNotificationsPurged!: number;
}
