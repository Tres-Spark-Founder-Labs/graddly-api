import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import {
  closedVocabularyMessage,
  LEVY_EMPLOYEE_COUNT_BANDS,
  LEVY_REGIONS,
} from '../levy-vocabulary.js';

/**
 * ── WHY TWO LISTS ARE VALIDATED AND TWO ARE NOT ─────────────────────────────
 *
 * The donor's side of the same comparison `UpsertRecipientProfileDto` makes,
 * held to the same rule. `regions` and `sizeBands` are closed sets — twelve UK
 * regions, four bands — so every element must be a permitted value; one that
 * is not could never equal a recipient's validated value, and would narrow
 * this donor's pool to nobody on that field without saying so. `sectors` and
 * `programmeTypes` are open, because real sectors and standards are not a
 * short list: any value is accepted, and each is normalised on write (trim,
 * collapse whitespace) exactly as the recipient's is, so equal words meet.
 * GET /levy-exchange/vocabulary serves both kinds.
 */
export class UpsertTransferPreferencesDto {
  @ApiProperty({
    type: [String],
    example: ['Construction', 'Engineering & Manufacturing'],
    description:
      'Open field: any values, each normalised on write. Suggestions from GET ' +
      '/levy-exchange/vocabulary (open.sector). Empty accepts every sector.',
  })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  sectors!: string[];

  @ApiProperty({
    type: [String],
    enum: LEVY_REGIONS,
    example: ['North West', 'Yorkshire and the Humber'],
    description:
      'Closed field: each one of GET /levy-exchange/vocabulary ' +
      'closed.region. Empty accepts every region.',
  })
  @IsArray()
  @IsIn(LEVY_REGIONS, {
    each: true,
    message: closedVocabularyMessage('regions', LEVY_REGIONS),
  })
  regions!: string[];

  @ApiProperty({
    type: [String],
    enum: LEVY_EMPLOYEE_COUNT_BANDS,
    example: ['10-49', '50-249'],
    description:
      'Closed field: each one of GET /levy-exchange/vocabulary ' +
      'closed.employeeCountBand. Empty accepts every size.',
  })
  @IsArray()
  @IsIn(LEVY_EMPLOYEE_COUNT_BANDS, {
    each: true,
    message: closedVocabularyMessage('sizeBands', LEVY_EMPLOYEE_COUNT_BANDS),
  })
  sizeBands!: string[];

  // Example from the register: ST0116 Software developer, checked 23 Sep 2026
  // https://skillsengland.education.gov.uk/apprenticeships/ST0116
  @ApiProperty({
    type: [String],
    example: ['ST0116 Software developer'],
    description:
      'Open field: any values, each normalised on write. Suggestions from GET ' +
      '/levy-exchange/vocabulary (open.programmeType). Empty accepts every ' +
      'programme type.',
  })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  programmeTypes!: string[];

  @ApiPropertyOptional({ nullable: true, example: '25000.00' })
  @IsOptional()
  @IsNumberString()
  maxPerRecipient?: string | null;

  @ApiProperty({ default: false })
  @IsBoolean()
  openMatching!: boolean;

  @ApiProperty({ default: false })
  @IsBoolean()
  anonymousMatching!: boolean;
}
