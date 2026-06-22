import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiExtraModels,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';

import { CreateRegistrationSessionDto } from './dto/create-registration-session.dto.js';
import {
  CreateRegistrationSessionResponseDto,
  RegistrationSessionResponseDto,
} from './dto/registration-session-response.dto.js';
import {
  BankDetailsStepDto,
  CompanyVerificationStepDto,
  ConsentStepDto,
  DasAccountStepDto,
  PayeReferenceStepDto,
  UpdateRegistrationStepDto,
} from './dto/registration-step.dto.js';
import { RegistrationWizardStep } from './enums/registration-wizard-step.enum.js';
import { RegistrationSessionService } from './registration-session.service.js';

@ApiTags('Flowportal Registration')
@ApiExtraModels(
  CreateRegistrationSessionDto,
  CreateRegistrationSessionResponseDto,
  RegistrationSessionResponseDto,
  CompanyVerificationStepDto,
  PayeReferenceStepDto,
  DasAccountStepDto,
  BankDetailsStepDto,
  ConsentStepDto,
  UpdateRegistrationStepDto,
)
@Controller({ path: 'flowportal-registration/sessions', version: '1' })
export class RegistrationWizardController {
  constructor(private readonly sessionService: RegistrationSessionService) {}

  @Post()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @ResponseMessage('Registration session created successfully')
  @ApiOperation({
    summary: 'Start ESFA employer registration wizard',
    description:
      'Public endpoint — creates a pre-account registration session and returns a one-time resume token. ' +
      'No authentication required. Sessions expire after 30 days. Optional contactEmail and sector/region ' +
      'from the eligibility checker can be pre-seeded.',
  })
  @ApiOkResponse({
    description: 'Session created with resume token',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(CreateRegistrationSessionResponseDto) },
      },
    },
  })
  create(@Body() body: CreateRegistrationSessionDto) {
    return this.sessionService.create(body);
  }

  @Get('by-token/:resumeToken')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ResponseMessage('Registration session retrieved successfully')
  @ApiOperation({
    summary: 'Resume registration wizard by token',
    description:
      'Public endpoint — loads saved progress for the opaque resume token. Bank account numbers are redacted on read.',
  })
  @ApiParam({
    name: 'resumeToken',
    description: 'Opaque resume token from session creation',
  })
  @ApiOkResponse({
    description: 'Session progress',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(RegistrationSessionResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiGoneResponse({ description: 'Session expired', type: ErrorResponseDto })
  getByToken(@Param('resumeToken') resumeToken: string) {
    return this.sessionService.getByToken(resumeToken);
  }

  @Put('by-token/:resumeToken/steps/:step')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ResponseMessage('Registration step saved successfully')
  @ApiOperation({
    summary: 'Save a wizard step',
    description:
      'Public endpoint — validates and persists step data, then advances currentStep when the saved step ' +
      'matches the current position. Companies House lookup runs on company_verification.',
  })
  @ApiParam({ name: 'resumeToken' })
  @ApiParam({ name: 'step', enum: RegistrationWizardStep })
  @ApiOkResponse({
    description: 'Updated session',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(RegistrationSessionResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDto })
  saveStep(
    @Param('resumeToken') resumeToken: string,
    @Param('step', new ParseEnumPipe(RegistrationWizardStep))
    step: RegistrationWizardStep,
    @Body() body: Record<string, unknown>,
  ) {
    return this.sessionService.saveStep(resumeToken, step, body);
  }

  @Post('by-token/:resumeToken/complete')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @ResponseMessage('Registration completed successfully')
  @ApiOperation({
    summary: 'Complete registration wizard',
    description:
      'Public endpoint — requires all five steps saved and a contact email. Marks session completed and ' +
      'enqueues a confirmation email.',
  })
  @ApiParam({ name: 'resumeToken' })
  @ApiOkResponse({
    description: 'Completed session',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(RegistrationSessionResponseDto) },
      },
    },
  })
  complete(@Param('resumeToken') resumeToken: string) {
    return this.sessionService.complete(resumeToken);
  }
}
