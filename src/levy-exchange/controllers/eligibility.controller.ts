import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ErrorResponseDto } from '../../common/dto/error-response.dto.js';
import { ResponseMessage } from '../../common/interceptors/response-message.decorator.js';
import { CheckLevyEligibilityDto } from '../dto/check-levy-eligibility.dto.js';
import { LevyEligibilityResponseDto } from '../dto/levy-eligibility-response.dto.js';
import { LevyEligibilityService } from '../services/levy-eligibility.service.js';

@ApiTags('Levy Exchange')
@ApiExtraModels(CheckLevyEligibilityDto, LevyEligibilityResponseDto)
@Controller({ path: 'levy-exchange/eligibility', version: '1' })
export class EligibilityController {
  constructor(private readonly eligibilityService: LevyEligibilityService) {}

  @Post('check')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ResponseMessage('Levy eligibility assessed successfully')
  @ApiOperation({
    summary: 'Anonymous SME levy transfer eligibility check',
    description:
      'Public endpoint (no authentication) for prospective FlowPortal employers. ' +
      'Evaluates employee count band, sector, region, and existing DAS account flag against ' +
      'configurable rules. Returns eligibility status, estimated funding band, next steps, ' +
      'and a registration path when eligible. Rate-limited to prevent abuse.',
  })
  @ApiOkResponse({
    description: 'Eligibility assessment result',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(LevyEligibilityResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed on input fields',
    type: ErrorResponseDto,
  })
  check(@Body() body: CheckLevyEligibilityDto): LevyEligibilityResponseDto {
    return this.eligibilityService.check(body);
  }
}
