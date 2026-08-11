import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
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
import { validate as validateUuid } from 'uuid';

import {
  ORGANISATION_ID_HEADER,
  PORTAL_TYPE_HEADER,
} from '../common/constants/organisation-headers.js';
import {
  ErrorResponseDto,
  TooManyRequestsResponseDto,
  ValidationErrorResponseDto,
} from '../common/dto/error-response.dto.js';
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { LearnerAccessible } from '../common/learner-scope/learner-accessible.decorator.js';
import { parsePortalType } from '../common/utils/parse-portal-type.util.js';
import { OrganisationListItemDto } from '../organisations/dto/organisation-list-item.dto.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { UpdateProfileDto } from '../users/dto/update-profile.dto.js';
import { MeResponseDto } from '../users/dto/user-response.dto.js';
import { UsersService } from '../users/users.service.js';

import { AuthService } from './auth.service.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { ActiveOrganisationMeDto } from './dto/active-organisation-context.dto.js';
import { AuthResponseDto } from './dto/auth-response.dto.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { SignupDto } from './dto/signup.dto.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { MfaChallengeResponseDto } from './mfa/dto/mfa-challenge-response.dto.js';

import type { AuthenticatedUser } from './interfaces/authenticated-user.interface.js';

type MeResult = Omit<
  AuthenticatedUser,
  'organisationId' | 'roles' | 'memberships' | 'password'
> & {
  activeOrganisation: ActiveOrganisationMeDto | null;
  organisations: OrganisationListItemDto[];
};

@ApiTags('Auth')
@ApiExtraModels(
  AuthResponseDto,
  MeResponseDto,
  ActiveOrganisationMeDto,
  OrganisationListItemDto,
)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Post('signup')
  @Throttle({ default: { limit: 0 }, auth: { ttl: 60_000, limit: 5 } })
  @ResponseMessage(
    'Account created. Please check your email to verify your account.',
  )
  @ApiHeader({
    name: 'X-Portal-Type',
    description:
      'Portal the user is registering from. Determines which frontend URL is embedded in the verification email.',
    required: false,
    schema: { type: 'string', enum: Object.values(PortalType) },
  })
  @ApiOperation({
    summary: 'Register a new user',
    description:
      'Creates a new user account and sends a verification email. JWTs are issued after email verification via POST /auth/verify-email. The email must be unique across the system. Rate limited to 5 requests per minute.',
  })
  @ApiCreatedResponse({
    description:
      'User registered successfully; verification email sent if applicable',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { type: 'object', nullable: true },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Email already in use',
    type: ErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Too many requests',
    type: TooManyRequestsResponseDto as never,
  })
  signup(
    @Body() dto: SignupDto,
    @Headers(PORTAL_TYPE_HEADER) rawPortalType?: string,
  ) {
    return this.authService.signup(dto, parsePortalType(rawPortalType));
  }

  @Post('login')
  @Throttle({ default: { limit: 0 }, auth: { ttl: 60_000, limit: 5 } })
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Logged in successfully')
  @ApiOperation({
    summary: 'Log in with email and password',
    description:
      'Authenticates a user with their email and password. Returns a new token pair, ' +
      'or — when the account has MFA enabled — a challengeToken to complete via POST ' +
      '/auth/mfa/verify. Fails if the credentials are invalid or the account is deactivated. ' +
      'Rate limited to 5 requests per minute.',
  })
  @ApiOkResponse({
    description: 'Login successful, or an MFA challenge to complete',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          oneOf: [
            { $ref: getSchemaPath(AuthResponseDto) },
            { $ref: getSchemaPath(MfaChallengeResponseDto) },
          ],
        },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid credentials or account deactivated',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Email address not verified',
    type: ErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Too many requests',
    type: TooManyRequestsResponseDto as never,
  })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('forgot-password')
  @Throttle({ default: { limit: 0 }, auth: { ttl: 60_000, limit: 5 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseMessage('If an account exists, a password reset email has been sent')
  @ApiHeader({
    name: 'X-Portal-Type',
    description:
      'Portal the user is resetting from. Determines which frontend URL is embedded in the reset email.',
    required: false,
    schema: { type: 'string', enum: Object.values(PortalType) },
  })
  @ApiOperation({
    summary: 'Request a password reset email',
    description:
      'Sends a password reset link when an active account exists for the email. Always returns 204 to avoid email enumeration. Rate limited to 5 requests per minute.',
  })
  @ApiNoContentResponse({
    description:
      'Request accepted (no indication whether the email is registered)',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Too many requests',
    type: TooManyRequestsResponseDto as never,
  })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Headers(PORTAL_TYPE_HEADER) rawPortalType?: string,
  ): Promise<void> {
    await this.authService.requestPasswordReset(
      dto.email,
      parsePortalType(rawPortalType),
    );
  }

  @Post('reset-password')
  @Throttle({ default: { limit: 0 }, auth: { ttl: 60_000, limit: 5 } })
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Password reset successfully')
  @ApiOperation({
    summary: 'Reset password with a token',
    description:
      'Sets a new password using the token from the reset email and returns a new JWT pair. Rate limited to 5 requests per minute.',
  })
  @ApiOkResponse({
    description: 'Password updated and tokens issued',
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
    description: 'Invalid or expired reset token, or account deactivated',
    type: ErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Too many requests',
    type: TooManyRequestsResponseDto as never,
  })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.password);
  }

  @Post('verify-email')
  @Throttle({ default: { limit: 0 }, auth: { ttl: 60_000, limit: 5 } })
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Email verified successfully')
  @ApiOperation({
    summary: 'Verify email with a token',
    description:
      'Marks the email as verified using the token from the verification email and returns a new JWT pair. Rate limited to 5 requests per minute.',
  })
  @ApiOkResponse({
    description: 'Email verified and tokens issued',
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
    description:
      'Invalid or expired verification token, or account deactivated',
    type: ErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Too many requests',
    type: TooManyRequestsResponseDto as never,
  })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token);
  }

  @Post('resend-verification')
  @Throttle({ default: { limit: 0 }, auth: { ttl: 60_000, limit: 5 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseMessage(
    'If an account exists and is unverified, a verification email has been sent',
  )
  @ApiHeader({
    name: 'X-Portal-Type',
    description:
      'Portal the user is verifying from. Determines which frontend URL is embedded in the verification email.',
    required: false,
    schema: { type: 'string', enum: Object.values(PortalType) },
  })
  @ApiOperation({
    summary: 'Resend email verification',
    description:
      'Sends a new verification email when an active, unverified account exists for the email. Always returns 204 to avoid email enumeration. Rate limited to 5 requests per minute.',
  })
  @ApiNoContentResponse({
    description:
      'Request accepted (no indication whether the email is registered or already verified)',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Too many requests',
    type: TooManyRequestsResponseDto as never,
  })
  async resendVerification(
    @Body() dto: ForgotPasswordDto,
    @Headers(PORTAL_TYPE_HEADER) rawPortalType?: string,
  ): Promise<void> {
    await this.authService.resendVerification(
      dto.email,
      parsePortalType(rawPortalType),
    );
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Token refreshed successfully')
  @ApiOperation({
    summary: 'Refresh an access token',
    description:
      'Exchanges a valid refresh token for a new access/refresh token pair. The old refresh token is invalidated (rotation). Reuse of a rotated token invalidates all refresh sessions for that user. Fails if the refresh token is expired or already used.',
  })
  @ApiOkResponse({
    description: 'Tokens refreshed successfully',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(AuthResponseDto) },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired refresh token, or account deactivated',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Email address not verified',
    type: ErrorResponseDto,
  })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @LearnerAccessible()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ResponseMessage('Logged out successfully')
  @ApiOperation({
    summary: 'Log out (invalidate refresh token)',
    description:
      'Invalidates the provided refresh token so it can no longer be used to obtain new access tokens. Requires a valid access token in the Authorization header.',
  })
  @ApiNoContentResponse({ description: 'Logged out successfully' })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token',
    type: ErrorResponseDto,
  })
  logout(@Body() dto: RefreshTokenDto): Promise<void> {
    return this.authService.logout(dto.refreshToken);
  }

  @LearnerAccessible()
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ResponseMessage('Logged out from all devices')
  @ApiOperation({
    summary: 'Log out from all devices',
    description:
      'Invalidates every refresh token for the current user by bumping the session version. Existing access tokens remain valid until they expire. Requires a valid access token.',
  })
  @ApiNoContentResponse({ description: 'All refresh sessions invalidated' })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token',
    type: ErrorResponseDto,
  })
  logoutAll(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.authService.logoutAll(user.id);
  }

  @LearnerAccessible()
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ResponseMessage('User profile retrieved')
  @ApiHeader({
    name: 'X-Organisation-Id',
    description:
      'Selects the active organisation. When omitted/blank, the first recent ' +
      'organisation is used. A malformed value yields activeOrganisation: null. ' +
      'A valid UUID for an organisation the user does not belong to returns 403.',
    required: false,
    schema: { format: 'uuid', type: 'string' },
  })
  @ApiOperation({
    summary: 'Get current user profile',
    description:
      "Returns the authenticated user's profile. activeOrganisation is resolved " +
      'from X-Organisation-Id (or the first recent org when absent); organisations ' +
      'lists every organisation the user actively belongs to.',
  })
  @ApiOkResponse({
    description: 'User profile with active organisation and organisations list',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(MeResponseDto) },
      },
    },
  })
  @ApiForbiddenResponse({
    description:
      'X-Organisation-Id refers to an organisation the user is not a member of',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token',
    type: ErrorResponseDto,
  })
  async me(
    @CurrentUser() user: AuthenticatedUser,
    @Headers(ORGANISATION_ID_HEADER) rawOrganisationId?: string,
  ): Promise<MeResult> {
    const { activeOrganisation, organisations } =
      await this.resolveActiveOrganisationContext(user.id, rawOrganisationId);

    const {
      organisationId: _organisationId,
      roles: _roles,
      memberships: _memberships,
      password: _password,
      ...publicUser
    } = user;
    return { ...publicUser, activeOrganisation, organisations };
  }

  @LearnerAccessible()
  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Profile updated successfully')
  @ApiHeader({
    name: 'X-Organisation-Id',
    description:
      'Selects the active organisation returned with the updated profile. When ' +
      'omitted/blank, the first recent organisation is used. A malformed value ' +
      'yields activeOrganisation: null. A valid UUID for an organisation the user ' +
      'does not belong to returns 403.',
    required: false,
    schema: { format: 'uuid', type: 'string' },
  })
  @ApiOperation({
    summary: 'Update current user profile',
    description:
      "Partially updates the authenticated user's profile. Email and password " +
      'changes require their own dedicated flows. Returns the full updated profile ' +
      'with activeOrganisation (resolved from X-Organisation-Id) and the ' +
      'organisations list.',
  })
  @ApiOkResponse({
    description: 'Updated user profile',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(MeResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'X-Organisation-Id refers to an organisation the user is not a member of',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token',
    type: ErrorResponseDto,
  })
  async updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
    @Headers(ORGANISATION_ID_HEADER) rawOrganisationId?: string,
  ): Promise<MeResult> {
    const [updatedUser, { activeOrganisation, organisations }] =
      await Promise.all([
        this.usersService.updateProfile(user.id, dto),
        this.resolveActiveOrganisationContext(user.id, rawOrganisationId),
      ]);

    const {
      password: _password,
      memberships: _memberships,
      ...publicUser
    } = updatedUser;
    return { ...publicUser, activeOrganisation, organisations };
  }

  /**
   * Resolves the `{ activeOrganisation, organisations }` pair for the `/me`
   * endpoints from the raw `X-Organisation-Id` header value.
   *
   * - blank/absent header → first recent active org (or null when none)
   * - malformed (non-UUID) header → activeOrganisation: null
   * - valid UUID, user not a member → 403 (propagated from the service)
   *
   * The organisations list is always returned in full regardless of the header.
   */
  private async resolveActiveOrganisationContext(
    userId: string,
    rawOrganisationId?: string,
  ): Promise<{
    activeOrganisation: ActiveOrganisationMeDto | null;
    organisations: OrganisationListItemDto[];
  }> {
    const trimmed = rawOrganisationId?.trim();
    const malformed = !!trimmed && !validateUuid(trimmed);

    const [activeOrganisation, organisations] = await Promise.all([
      malformed
        ? Promise.resolve(null)
        : this.authService.resolveActiveOrganisationForUser(
            userId,
            trimmed || undefined,
          ),
      this.authService.resolveOrganisationsForUser(userId),
    ]);

    return { activeOrganisation, organisations };
  }
}
