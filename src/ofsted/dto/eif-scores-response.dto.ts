import { ApiProperty } from '@nestjs/swagger';

import { EifRag } from '../enums/eif-rag.enum.js';

export class EifCriterionScoreDto {
  @ApiProperty()
  slug!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ minimum: 0, maximum: 100 })
  percent!: number;

  @ApiProperty({ enum: EifRag })
  rag!: EifRag;
}

export class EifScoresPayloadDto {
  @ApiProperty({ minimum: 0, maximum: 100 })
  overallPercent!: number;

  @ApiProperty({ enum: EifRag })
  overallRag!: EifRag;

  @ApiProperty()
  alertBanner!: boolean;

  @ApiProperty({ type: [EifCriterionScoreDto] })
  criteria!: EifCriterionScoreDto[];

  @ApiProperty()
  calculatedAt!: string;

  @ApiProperty()
  cached!: boolean;
}
