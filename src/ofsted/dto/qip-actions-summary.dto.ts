import { ApiProperty } from '@nestjs/swagger';

export class QipActionsSummaryDto {
  @ApiProperty({
    description: 'Total non-deleted QIP actions in the organisation.',
  })
  total!: number;

  @ApiProperty({ description: 'Actions with status completed.' })
  completed!: number;

  @ApiProperty({
    description: 'Actions that are overdue (derived; not a stored status).',
  })
  overdue!: number;

  @ApiProperty({
    minimum: 0,
    maximum: 100,
    description: 'Rounded percentage of completed actions (0 when total is 0).',
  })
  percentComplete!: number;
}
