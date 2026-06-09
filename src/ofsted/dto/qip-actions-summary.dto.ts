import { ApiProperty } from '@nestjs/swagger';

export class QipActionsSummaryDto {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  completed!: number;

  @ApiProperty()
  overdue!: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  percentComplete!: number;
}
