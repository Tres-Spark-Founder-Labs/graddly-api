import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
  getSchemaPath,
} from '@nestjs/swagger';

import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { ActiveOrganisationGuard } from '../../auth/guards/active-organisation.guard.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { ORGANISATION_ID_HEADER } from '../../common/constants/organisation-headers.js';
import { setCurrentUserId } from '../../common/context/correlation-id-context.js';
import {
  ErrorResponseDto,
  ValidationErrorResponseDto,
} from '../../common/dto/error-response.dto.js';
import { PaginationMetaDto } from '../../common/dto/pagination-meta.dto.js';
import { ResponseMessage } from '../../common/interceptors/response-message.decorator.js';
import { setLastKnownUserIdForGuc } from '../../database/apply-tenant-gucs.js';
import { RecipientProfileResponseDto } from '../dto/recipient-profile-response.dto.js';
import { SearchRecipientDirectoryDto } from '../dto/search-recipient-directory.dto.js';
import { LevyRecipientProfileService } from '../services/levy-recipient-profile.service.js';

import type { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface.js';

/**
 * F1.1.4 AC2 — the donor-facing SME directory.
 *
 * Deliberately separate from RecipientProfileController: that resource is
 * singular and org-scoped ("my profile"), whereas this is a cross-tenant
 * read of organisations that opted in. Keeping them apart stops the
 * privacy boundary from being blurred by a shared route prefix.
 */
@ApiTags('Levy Exchange')
@ApiExtraModels(RecipientProfileResponseDto, PaginationMetaDto)
@Controller({ path: 'levy-exchange/recipient-directory', version: '1' })
@UseGuards(JwtAuthGuard, ActiveOrganisationGuard)
@ApiBearerAuth()
@ApiHeader({
  name: ORGANISATION_ID_HEADER,
  description: 'Active organisation UUID (optional override)',
  required: false,
})
@ApiUnauthorizedResponse({
  description: 'Missing or invalid bearer token',
  type: ErrorResponseDto,
})
@ApiForbiddenResponse({
  description: 'No active organisation context',
  type: ErrorResponseDto,
})
export class RecipientDirectoryController {
  constructor(
    private readonly recipientProfileService: LevyRecipientProfileService,
  ) {}

  @Get()
  @ResponseMessage('Recipient directory retrieved successfully')
  @ApiOperation({
    summary: 'Search or browse SME levy transfer recipients',
    description:
      'Returns SME recipient profiles that have opted in to the directory ' +
      '(isListed = true), optionally filtered by sector, region and programme ' +
      'type. The requesting organisation is excluded from its own results. ' +
      'Profiles that have not opted in are invisible here and remain readable ' +
      'only by their owning organisation.',
  })
  @ApiOkResponse({
    description: 'Paginated list of listed recipient profiles',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(RecipientProfileResponseDto) },
        },
        meta: { $ref: getSchemaPath(PaginationMetaDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  search(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SearchRecipientDirectoryDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.recipientProfileService.searchDirectory(
      user.organisationId!,
      query,
    );
  }
}
