import { ApiProperty } from '@nestjs/swagger';

import {
  LEVY_EMPLOYEE_COUNT_BANDS,
  LEVY_PROGRAMME_TYPE_SUGGESTIONS,
  LEVY_REGIONS,
  LEVY_SECTOR_SUGGESTIONS,
} from '../levy-vocabulary.js';

/**
 * Fields whose values are validated on write. A value outside the list is
 * rejected, naming the field and these values.
 */
export class LevyClosedVocabularyDto {
  @ApiProperty({
    type: [String],
    example: LEVY_REGIONS,
    description:
      'Permitted values for the recipient profile’s `region`, the donor ' +
      'preference’s `regions` and the eligibility check’s `region`.',
  })
  region!: string[];

  @ApiProperty({
    type: [String],
    example: LEVY_EMPLOYEE_COUNT_BANDS,
    description:
      'Permitted values for the recipient profile’s `employeeCountBand`, ' +
      'the donor preference’s `sizeBands` and the eligibility check’s ' +
      '`employeeCountBand`.',
  })
  employeeCountBand!: string[];
}

/**
 * Fields that accept any value. These lists are suggestions, not constraints;
 * values are normalised on write (trimmed, internal whitespace collapsed).
 */
export class LevyOpenVocabularyDto {
  @ApiProperty({
    type: [String],
    example: LEVY_SECTOR_SUGGESTIONS,
    description:
      'Suggestions for the recipient profile’s `sector`, the donor ' +
      'preference’s `sectors` and the eligibility check’s `sector`. ' +
      'Any value is accepted.',
  })
  sector!: string[];

  @ApiProperty({
    type: [String],
    example: LEVY_PROGRAMME_TYPE_SUGGESTIONS,
    description:
      'Suggestions for the recipient profile’s `programmeType` and the ' +
      'donor preference’s `programmeTypes`. Any value is accepted.',
  })
  programmeType!: string[];
}

/**
 * The Levy Exchange vocabulary. `closed` and `open` are separate objects so a
 * client cannot read a closed field as a list of suggestions, or an open one
 * as a constraint.
 */
export class LevyVocabularyResponseDto {
  @ApiProperty({ type: LevyClosedVocabularyDto })
  closed!: LevyClosedVocabularyDto;

  @ApiProperty({ type: LevyOpenVocabularyDto })
  open!: LevyOpenVocabularyDto;
}
