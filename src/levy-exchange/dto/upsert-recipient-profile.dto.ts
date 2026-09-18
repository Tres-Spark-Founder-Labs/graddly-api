import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsNumberString,
  IsString,
  MaxLength,
} from 'class-validator';

import {
  closedVocabularyMessage,
  LEVY_EMPLOYEE_COUNT_BANDS,
  LEVY_REGIONS,
} from '../levy-vocabulary.js';

/**
 * ── WHY TWO FIELDS ARE VALIDATED AND TWO ARE NOT ────────────────────────────
 *
 * Matching compares these four fields to a donor's preferences by exact
 * equality (`levy-vocabulary.ts` has the full account). `region` and
 * `employeeCountBand` are closed in the real world — twelve UK regions, four
 * bands that cover every size — so a value outside the set is a mistake, and
 * it is rejected here rather than stored to quietly match no donor who
 * filters. `sector` and `programmeType` are open: no list of sectors is
 * complete and there are several hundred standards, so closing them on a
 * handful of values would refuse real answers. They are accepted as given and
 * normalised on write (trim, collapse whitespace) exactly as the donor's
 * preferences are. GET /levy-exchange/vocabulary serves both kinds.
 */
export class UpsertRecipientProfileDto {
  @ApiProperty({
    maxLength: 100,
    example: 'Construction',
    description:
      'Open field: any value, normalised on write. Suggestions from GET ' +
      '/levy-exchange/vocabulary (open.sector).',
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
    enum: LEVY_EMPLOYEE_COUNT_BANDS,
    example: '10-49',
    description:
      'Closed field: one of GET /levy-exchange/vocabulary ' +
      'closed.employeeCountBand.',
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
    example: 'ST0415 Software Developer',
    description:
      'Open field: any value, normalised on write. Suggestions from GET ' +
      '/levy-exchange/vocabulary (open.programmeType).',
  })
  @IsString()
  @MaxLength(100)
  programmeType!: string;

  @ApiProperty({
    example: '15000.00',
    description: 'Decimal amount of levy transfer required (GBP)',
  })
  @IsNumberString()
  transferAmountRequired!: string;

  @ApiProperty({
    default: false,
    description: 'Whether the recipient organisation already has a DAS account',
  })
  @IsBoolean()
  hasDasAccount!: boolean;

  @ApiPropertyOptional({
    default: false,
    description:
      'Opt in to the donor-facing SME directory. While false the profile is ' +
      'visible only to this organisation; setting it true makes sector, ' +
      'region, programme type and amount required readable by levy-paying ' +
      'employers searching for transfer recipients.',
  })
  @IsOptional()
  @IsBoolean()
  isListed?: boolean;
}
