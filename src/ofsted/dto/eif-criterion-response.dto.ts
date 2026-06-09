import { ApiProperty } from '@nestjs/swagger';

export class EifCriterionDefinitionDto {
  @ApiProperty({
    description: 'Stable criterion identifier used in scores and QIP actions.',
    example: 'curriculum_intent',
  })
  slug!: string;

  @ApiProperty({
    description: 'Human-readable label for hub UI.',
    example: 'Curriculum intent',
  })
  label!: string;
}
