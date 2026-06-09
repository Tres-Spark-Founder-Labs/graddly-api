import { ApiProperty } from '@nestjs/swagger';

export class EifCriterionDefinitionDto {
  @ApiProperty()
  slug!: string;

  @ApiProperty()
  label!: string;
}
