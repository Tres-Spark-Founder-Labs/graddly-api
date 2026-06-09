import {
  Controller,
  Get,
  HttpStatus,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  ErrorResponseDto,
  TooManyRequestsResponseDto,
} from '../../common/dto/error-response.dto.js';
import { AuthResponseDto } from '../dto/auth-response.dto.js';

import { OidcAuthGuard } from './guards/oidc-auth.guard.js';
import { IOidcAuthProfile } from './interfaces/oidc-auth-profile.interface.js';
import { OidcAuthService } from './oidc-auth.service.js';

import type { Request, Response } from 'express';

@ApiTags('Auth')
@ApiExtraModels(AuthResponseDto)
@Controller('auth/oidc')
export class OidcController {
  constructor(private readonly oidcAuthService: OidcAuthService) {}

  @Get('login')
  @Throttle({ default: { limit: 0 }, auth: { ttl: 60_000, limit: 5 } })
  @UseGuards(OidcAuthGuard)
  @ApiOperation({
    summary: 'Start GOV.UK One Login sign-in',
    description:
      'Redirects the browser to the One Login authorization endpoint. Requires OIDC session cookie support.',
  })
  @ApiFoundResponse({ description: 'Redirect to One Login' })
  @ApiTooManyRequestsResponse({
    description: 'Too many requests',
    type: TooManyRequestsResponseDto as never,
  })
  login(): void {
    // Passport performs the redirect before this handler runs.
  }

  @Get('callback')
  @UseGuards(OidcAuthGuard)
  @ApiOperation({
    summary: 'One Login OAuth callback',
    description:
      'Exchanges the authorization code, links to an existing user by verified email, and returns tokens as JSON or redirects to OIDC_SUCCESS_REDIRECT_URI.',
  })
  @ApiOkResponse({
    description: 'Logged in successfully (JSON when no success redirect URI)',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(AuthResponseDto) },
      },
    },
  })
  @ApiFoundResponse({
    description: 'Redirect to frontend with tokens in URL fragment',
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication failed or account deactivated',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'No linked account or unverified email',
    type: ErrorResponseDto,
  })
  async callback(
    @Req() req: Request & { user?: IOidcAuthProfile },
    @Res() res: Response,
  ): Promise<void> {
    const profile = req.user;
    if (!profile) {
      throw new UnauthorizedException('One Login authentication failed');
    }

    const tokens = await this.oidcAuthService.completeLogin(profile);
    const redirectUri = this.oidcAuthService.getSuccessRedirectUri();

    if (redirectUri) {
      res.redirect(
        HttpStatus.FOUND,
        this.oidcAuthService.buildSuccessRedirectUrl(tokens),
      );
      return;
    }

    res.status(HttpStatus.OK).json({
      message: 'Logged in successfully',
      data: tokens,
    });
  }
}
