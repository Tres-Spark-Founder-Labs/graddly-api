import { ApiProperty } from '@nestjs/swagger';

import { EifRag } from '../enums/eif-rag.enum.js';

export class EifCriterionScoreDto {
  @ApiProperty({ example: 'behaviour_attitudes' })
  slug!: string;

  @ApiProperty({ example: 'Behaviour and attitudes' })
  label!: string;

  @ApiProperty({
    minimum: 0,
    maximum: 100,
    description: 'Criterion readiness percentage (0–100).',
  })
  percent!: number;

  @ApiProperty({
    enum: EifRag,
    description: 'RAG band: red < 60, amber 60–79, green ≥ 80.',
  })
  rag!: EifRag;
}

export class EifScoresPayloadDto {
  @ApiProperty({
    minimum: 0,
    maximum: 100,
    description: 'Mean of the seven criterion percentages.',
  })
  overallPercent!: number;

  @ApiProperty({ enum: EifRag, description: 'RAG band for overallPercent.' })
  overallRag!: EifRag;

  @ApiProperty({
    description:
      'True when any criterion percent is below 75% (hub alert banner).',
  })
  alertBanner!: boolean;

  @ApiProperty({ type: [EifCriterionScoreDto] })
  criteria!: EifCriterionScoreDto[];

  @ApiProperty({
    description: 'ISO timestamp when scores were calculated (UTC).',
    example: '2026-05-28T12:00:00.000Z',
  })
  calculatedAt!: string;

  @ApiProperty({
    description:
      'True when served from Redis cache; false on fresh calculation.',
  })
  cached!: boolean;
}
