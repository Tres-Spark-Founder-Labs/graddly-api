import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ActiveOrganisationGuard } from '../auth/guards/active-organisation.guard.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ORGANISATION_ID_HEADER } from '../common/constants/organisation-headers.js';
import { setCurrentUserId } from '../common/context/correlation-id-context.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import { AiProgrammeCatalogueService } from './ai-programme-catalogue.service.js';
import {
  AiProgrammeCatalogueEntryDto,
  AiProgrammeDetailDto,
  AiProgrammeModuleDto,
} from './dto/ai-programme-catalogue-response.dto.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('AI Programmes')
@ApiExtraModels(
  AiProgrammeCatalogueEntryDto,
  AiProgrammeDetailDto,
  AiProgrammeModuleDto,
)
@Controller({ path: 'ai-programmes/catalogue', version: '1' })
@UseGuards(JwtAuthGuard, ActiveOrganisationGuard)
@ApiBearerAuth()
@ApiHeader({
  name: ORGANISATION_ID_HEADER,
  description: 'Active Flow (SME) organisation UUID',
  required: false,
})
@ApiUnauthorizedResponse({
  description: 'Missing or invalid bearer token',
  type: ErrorResponseDto,
})
@ApiForbiddenResponse({
  description: 'Requires Flow portal organisation',
  type: ErrorResponseDto,
})
export class AiProgrammeCatalogueController {
  constructor(private readonly catalogueService: AiProgrammeCatalogueService) {}

  @Get()
  @ResponseMessage('AI programme catalogue retrieved successfully')
  @ApiOperation({
    summary: 'List FlowPortal AI programme catalogue',
    description:
      'PRD F4.4.1 — Returns active FlowPortal AI apprenticeship programmes available to the active Flow (SME) organisation. ' +
      'Catalogue data is platform-seeded under a dedicated provider org; cross-org reads use RLS bootstrap. Flow portal only.',
  })
  @ApiOkResponse({
    description: 'Active AI programmes with module counts',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(AiProgrammeCatalogueEntryDto) },
        },
      },
    },
  })
  list(@CurrentUser() user: AuthenticatedUser) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.catalogueService.listCatalogue(user.organisationId!);
  }

  @Get(':programmeId')
  @ResponseMessage('AI programme detail retrieved successfully')
  @ApiOperation({
    summary: 'Get FlowPortal AI programme detail with module outline',
    description:
      'PRD F4.4.1 — Programme summary plus ordered curriculum modules (slug, title, sort order). ' +
      'Used by FlowPortal mobile when an SME reviews an AI track before enrolment. Flow portal only.',
  })
  @ApiOkResponse({
    description: 'AI programme with module outline',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(AiProgrammeDetailDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Programme not in active AI catalogue',
    type: ErrorResponseDto,
  })
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('programmeId', ParseUUIDPipe) programmeId: string,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.catalogueService.getCatalogueDetail(
      user.organisationId!,
      programmeId,
    );
  }
}
