import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { SarGrade } from '../sar-template.config.js';

export class UpdateSarSectionDto {
  @ApiProperty({ example: 'curriculum_intent' })
  @IsString()
  key!: string;

  /**
   * Generous but bounded. A SAR section is a few hundred words; 20k characters
   * is far beyond any real narrative and still stops an unbounded write into
   * a jsonb column.
   */
  @ApiPropertyOptional({ maxLength: 20000 })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  narrative?: string;

  @ApiPropertyOptional({
    enum: SarGrade,
    nullable: true,
    description:
      'Self-assessed grade. Never inferred from the platform score — the ' +
      'grade is a judgement the provider must be willing to defend.',
  })
  @IsOptional()
  @IsEnum(SarGrade)
  grade?: SarGrade | null;
}

export class UpdateSarReportDto {
  @ApiProperty({ type: [UpdateSarSectionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateSarSectionDto)
  sections!: UpdateSarSectionDto[];
}
