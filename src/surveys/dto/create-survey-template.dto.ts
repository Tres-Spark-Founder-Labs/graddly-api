import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import {
  SURVEY_MAX_QUESTIONS,
  SurveyQuestionType,
} from '../enums/survey-question-type.enum.js';

export class SurveyQuestionDto {
  @ApiProperty({ enum: SurveyQuestionType })
  @IsEnum(SurveyQuestionType)
  type!: SurveyQuestionType;

  @ApiProperty({ maxLength: 300 })
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  prompt!: string;
}

/** F2.4.3 AC1 — "configurable with up to 10 questions". */
export class CreateSurveyTemplateDto {
  @ApiProperty({ maxLength: 160 })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @ApiProperty({ type: [SurveyQuestionDto], maxItems: SURVEY_MAX_QUESTIONS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(SURVEY_MAX_QUESTIONS)
  @ValidateNested({ each: true })
  @Type(() => SurveyQuestionDto)
  questions!: SurveyQuestionDto[];
}
