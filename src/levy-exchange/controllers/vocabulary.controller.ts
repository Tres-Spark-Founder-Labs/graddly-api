import { Controller, Get } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';

import { ResponseMessage } from '../../common/interceptors/response-message.decorator.js';
import {
  LevyClosedVocabularyDto,
  LevyOpenVocabularyDto,
  LevyVocabularyResponseDto,
} from '../dto/levy-vocabulary-response.dto.js';
import {
  LEVY_EMPLOYEE_COUNT_BANDS,
  LEVY_PROGRAMME_TYPE_SUGGESTIONS,
  LEVY_REGIONS,
  LEVY_SECTOR_SUGGESTIONS,
} from '../levy-vocabulary.js';

/**
 * The values matching compares, served so neither portal keeps a copy.
 *
 * Public, like the eligibility check: the flow app's checker reads it before
 * anyone has an account. It is static reference data with no tenant in it and
 * no database read.
 */
@ApiTags('Levy Exchange')
@ApiExtraModels(
  LevyVocabularyResponseDto,
  LevyClosedVocabularyDto,
  LevyOpenVocabularyDto,
)
@Controller({ path: 'levy-exchange/vocabulary', version: '1' })
export class VocabularyController {
  @Get()
  @ResponseMessage('Levy Exchange vocabulary retrieved successfully')
  @ApiOperation({
    summary: 'The Levy Exchange vocabulary',
    description:
      'Public. The closed fields with their permitted values (validated on the ' +
      'recipient profile PUT, the transfer preference write and the eligibility ' +
      'check) and the open fields with suggestions (any value accepted, ' +
      'normalised on write). Values are display strings, compared exactly.',
  })
  @ApiOkResponse({
    description:
      'Closed fields with permitted values; open fields with suggestions',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(LevyVocabularyResponseDto) },
      },
    },
  })
  get(): LevyVocabularyResponseDto {
    return {
      closed: {
        region: [...LEVY_REGIONS],
        employeeCountBand: [...LEVY_EMPLOYEE_COUNT_BANDS],
      },
      open: {
        sector: [...LEVY_SECTOR_SUGGESTIONS],
        programmeType: [...LEVY_PROGRAMME_TYPE_SUGGESTIONS],
      },
    };
  }
}
