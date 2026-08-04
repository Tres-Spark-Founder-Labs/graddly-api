import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';

import { SubmitSurveyResponseDto } from './dto/submit-survey-response.dto.js';
import { SurveysService } from './surveys.service.js';

/**
 * F2.4.3 AC2 — "no login required for employer to respond".
 *
 * Deliberately outside the authenticated controller and with no guards. The
 * token in the path is the entire authorisation: holding it proves the bearer
 * was sent this survey.
 *
 * That makes both routes a brute-force target, so both are throttled hard.
 * The token is 32 random bytes, which is not guessable, but an unauthenticated
 * endpoint that will happily field thousands of requests a minute is a gift to
 * anyone who wants to find out.
 */
@ApiTags('Employer Surveys (public)')
@Controller({ path: 'public/surveys', version: '1' })
export class PublicSurveysController {
  constructor(private readonly service: SurveysService) {}

  @Get(':token')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @ResponseMessage('Survey retrieved successfully')
  @ApiOperation({
    summary: 'Open a survey by its emailed link — no login required',
    description:
      'Returns only the campaign name and its questions. Nothing about the ' +
      'provider, the other recipients, or how anyone else answered.',
  })
  @ApiOkResponse({ description: 'The survey to complete' })
  @ApiNotFoundResponse({
    description: 'Link not found',
    type: ErrorResponseDto,
  })
  getSurvey(@Param('token') token: string) {
    return this.service.getPublicSurvey(token);
  }

  @Post(':token/responses')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ResponseMessage('Response recorded successfully')
  @ApiOperation({ summary: 'Submit answers — no login required' })
  @ApiOkResponse({ description: 'Response recorded' })
  @ApiBadRequestResponse({
    description:
      'Survey closed, already answered, or an answer outside its scale',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Link not found',
    type: ErrorResponseDto,
  })
  submit(@Param('token') token: string, @Body() dto: SubmitSurveyResponseDto) {
    return this.service.submitPublicResponse(token, dto);
  }
}
