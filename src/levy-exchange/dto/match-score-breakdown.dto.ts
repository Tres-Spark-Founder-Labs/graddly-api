import { ApiProperty } from '@nestjs/swagger';

export class MatchScoreBreakdownDto {
  @ApiProperty()
  sector!: number;

  @ApiProperty()
  region!: number;

  @ApiProperty()
  programmeType!: number;

  @ApiProperty()
  amount!: number;
}
