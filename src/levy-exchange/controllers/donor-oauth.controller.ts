import {
  Controller,
  Get,
  HttpStatus,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';

import { ErrorResponseDto } from '../../common/dto/error-response.dto.js';
import { DonorLinkResponseDto } from '../dto/donor-link-response.dto.js';
import { DonorOAuthCallbackQueryDto } from '../dto/donor-oauth-callback-query.dto.js';
import { DasDonorLinkService } from '../services/das-donor-link.service.js';

import type { Response } from 'express';

@ApiTags('Levy Exchange')
@ApiExtraModels(DonorOAuthCallbackQueryDto, DonorLinkResponseDto)
@Controller({ path: 'levy-exchange/donor-links/oauth', version: '1' })
export class DonorOAuthController {
  constructor(private readonly donorLinkService: DasDonorLinkService) {}

  @Get('callback')
  @ApiOperation({
    summary: 'Donor DAS OAuth callback',
    description:
      'Public callback endpoint that exchanges the authorization code, stores encrypted donor tokens, and redirects to the Flow portal when configured.',
  })
  @ApiOkResponse({
    description: 'OAuth completed (JSON when no frontend redirect configured)',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(DonorLinkResponseDto) },
      },
    },
  })
  @ApiFoundResponse({
    description: 'Redirect to Flow portal after successful consent',
  })
  @ApiBadRequestResponse({
    description: 'Invalid or expired OAuth state parameter',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing OAuth callback parameters or token exchange failed',
    type: ErrorResponseDto,
  })
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!code || !state) {
      throw new UnauthorizedException('Missing OAuth callback parameters');
    }

    try {
      const link = await this.donorLinkService.completeOAuthCallback(
        code,
        state,
      );
      const redirectUri = this.buildSuccessRedirectUrl(link.id);
      if (redirectUri) {
        res.redirect(HttpStatus.FOUND, redirectUri);
        return;
      }

      res.status(HttpStatus.OK).json({
        message: 'Donor DAS account linked successfully',
        data: link,
      });
    } catch (error) {
      const errorRedirect = this.buildErrorRedirectUrl(error);
      if (errorRedirect) {
        res.redirect(HttpStatus.FOUND, errorRedirect);
        return;
      }
      throw error;
    }
  }

  private buildSuccessRedirectUrl(linkId: string): string | null {
    const base = process.env.FRONTEND_BASE_FLOW_URL?.trim();
    if (!base) {
      return null;
    }
    const url = new URL('/donor-links/oauth/callback', base);
    url.searchParams.set('status', 'success');
    url.searchParams.set('linkId', linkId);
    return url.toString();
  }

  private buildErrorRedirectUrl(error: unknown): string | null {
    const base = process.env.FRONTEND_BASE_FLOW_URL?.trim();
    if (!base) {
      return null;
    }
    const url = new URL('/donor-links/oauth/callback', base);
    url.searchParams.set('status', 'error');
    url.searchParams.set(
      'message',
      error instanceof Error ? error.message : 'OAuth callback failed',
    );
    return url.toString();
  }
}
