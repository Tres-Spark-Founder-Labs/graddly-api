import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsString, MaxLength } from 'class-validator';

import {
  closedVocabularyMessage,
  LEVY_EMPLOYEE_COUNT_BANDS,
  LEVY_REGIONS,
} from '../levy-vocabulary.js';

/**
 * The same vocabulary as the recipient profile, held to the same rule.
 *
 * This used to take its own slugs (`10_49`, `north_west`, `technology`), a
 * third list beside matching's. The eligibility rules compare
 * `employeeCountBand` exactly and key funding bands by `sector`, so a value
 * from any other list failed quietly — a slug band came back "not eligible",
 * an unknown sector got the default funding band. Closed fields are therefore
 * validated here too, rather than answered wrongly; `sector` stays open and is
 * normalised before the funding-band lookup.
 */
export class CheckLevyEligibilityDto {
  @ApiProperty({
    enum: LEVY_EMPLOYEE_COUNT_BANDS,
    example: '10-49',
    description:
      'Closed field: one of GET /levy-exchange/vocabulary ' +
      'closed.employeeCountBand. 1-9, 10-49 and 50-249 are SME bands; 250+ is ' +
      'levy-paying.',
  })
  @IsIn(LEVY_EMPLOYEE_COUNT_BANDS, {
    message: closedVocabularyMessage(
      'employeeCountBand',
      LEVY_EMPLOYEE_COUNT_BANDS,
    ),
  })
  employeeCountBand!: string;

  @ApiProperty({
    maxLength: 100,
    example: 'Construction',
    description:
      'Open field: any value. Suggestions from GET /levy-exchange/vocabulary ' +
      '(open.sector); a sector with no configured funding band gets the default.',
  })
  @IsString()
  @MaxLength(100)
  sector!: string;

  @ApiProperty({
    enum: LEVY_REGIONS,
    example: 'North West',
    description:
      'Closed field: one of GET /levy-exchange/vocabulary closed.region.',
  })
  @IsIn(LEVY_REGIONS, {
    message: closedVocabularyMessage('region', LEVY_REGIONS),
  })
  region!: string;

  @ApiProperty({
    example: false,
    description:
      'Whether the employer already has a Digital Apprenticeship Service account',
  })
  @IsBoolean()
  hasDasAccount!: boolean;
}
