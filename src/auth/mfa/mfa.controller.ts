import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  ErrorResponseDto,
  TooManyRequestsResponseDto,
  ValidationErrorResponseDto,
} from '../../common/dto/error-response.dto.js';
import { ResponseMessage } from '../../common/interceptors/response-message.decorator.js';
import { LearnerAccessible } from '../../common/learner-scope/learner-accessible.decorator.js';
import { AuthService } from '../auth.service.js';
import { CurrentUser } from '../decorators/current-user.decorator.js';
import { AuthResponseDto } from '../dto/auth-response.dto.js';
import { JwtAuthGuard } from '../guards/jwt-auth.guard.js';

import { MfaChallengeResponseDto } from './dto/mfa-challenge-response.dto.js';
import { MfaCodeDto } from './dto/mfa-code.dto.js';
import { MfaConfirmResponseDto } from './dto/mfa-confirm-response.dto.js';
import { MfaEnrollResponseDto } from './dto/mfa-enroll-response.dto.js';
import { MfaVerifyDto } from './dto/mfa-verify.dto.js';
import { MfaService } from './mfa.service.js';

import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface.js';

@ApiTags('Auth')
// Every DTO reachable through getSchemaPath() must be registered here, or the
// emitted spec contains a $ref to a schema that does not exist. Swagger UI
// renders that as an empty box rather than an error, so it went unnoticed
// until the spec was consumed by a code generator.
@ApiExtraModels(
  AuthResponseDto,
  MfaChallengeResponseDto,
  MfaEnrollResponseDto,
  MfaConfirmResponseDto,
)
@Controller('auth/mfa')
export class MfaController {
  constructor(
    private readonly mfaService: MfaService,
    private readonly authService: AuthService,
  ) {}

  @LearnerAccessible()
  @Post('enroll')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Scan the QR code with your authenticator app, then confirm')
  @ApiOperation({
    summary: 'Start TOTP enrollment',
    description:
      'Generates a new TOTP secret and provisioning URI. MFA is not active until the ' +
      'first code is confirmed via POST /auth/mfa/confirm. Calling this again replaces ' +
      'any unconfirmed secret.',
  })
  @ApiOkResponse({
    description: 'Enrollment started',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(MfaEnrollResponseDto) },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token',
    type: ErrorResponseDto,
  })
  enroll(@CurrentUser() user: AuthenticatedUser) {
    return this.mfaService.generateEnrollment(user);
  }

  @LearnerAccessible()
  @Post('confirm')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('MFA enabled')
  @ApiOperation({
    summary: 'Confirm TOTP enrollment',
    description:
      'Verifies the first code from the authenticator app and activates MFA. Returns ' +
      'one-time recovery codes — shown once, store them safely.',
  })
  @ApiOkResponse({
    description: 'MFA activated',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(MfaConfirmResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'No enrollment in progress',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing/invalid access token, or invalid code',
    type: ErrorResponseDto,
  })
  confirm(@CurrentUser() user: AuthenticatedUser, @Body() dto: MfaCodeDto) {
    return this.mfaService.confirmEnrollment(user.id, dto.code);
  }

  @LearnerAccessible()
  @Post('disable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseMessage('MFA disabled')
  @ApiOperation({
    summary: 'Disable MFA',
    description:
      'Requires a valid current TOTP code to confirm the request, then removes the ' +
      'secret and recovery codes.',
  })
  @ApiNoContentResponse({ description: 'MFA disabled' })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing/invalid access token, or invalid code',
    type: ErrorResponseDto,
  })
  async disable(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MfaCodeDto,
  ): Promise<void> {
    await this.mfaService.disableMfa(user.id, dto.code);
  }

  @Post('verify')
  @Throttle({ default: { limit: 0 }, auth: { ttl: 60_000, limit: 5 } })
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Logged in successfully')
  @ApiOperation({
    summary: 'Complete login with a second-step MFA code',
    description:
      'Exchanges the challengeToken from POST /auth/login (returned when the account ' +
      'has MFA enabled) plus a TOTP code or a recovery code for a token pair. Rate ' +
      'limited to 5 requests per minute.',
  })
  @ApiCreatedResponse({
    description: 'Login complete',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(AuthResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid/expired challenge token, or invalid code',
    type: ErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Too many requests',
    type: TooManyRequestsResponseDto as never,
  })
  verify(@Body() dto: MfaVerifyDto) {
    return this.authService.verifyMfaChallenge(dto);
  }
}
