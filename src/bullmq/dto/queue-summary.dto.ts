import { ApiProperty } from '@nestjs/swagger';

import { QueueJobCountsDto } from './queue-job-counts.dto.js';

export class QueueSummaryDto {
  @ApiProperty({ example: 'ilr-submit' })
  name!: string;

  @ApiProperty({ type: QueueJobCountsDto })
  counts!: QueueJobCountsDto;
}
