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

import { LearnerDocumentItemDto } from './dto/learner-document-item.dto.js';
import {
  LearnerDocumentsEnrolmentGroupDto,
  LearnerDocumentsResponseDto,
} from './dto/learner-documents-response.dto.js';
import { ListLearnerDocumentsQueryDto } from './dto/list-learner-documents-query.dto.js';
import { LearnerDocumentsService } from './learner-documents.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Learners')
@ApiExtraModels(
  LearnerDocumentsResponseDto,
  LearnerDocumentsEnrolmentGroupDto,
  LearnerDocumentItemDto,
  ListLearnerDocumentsQueryDto,
)
@Controller({ path: 'learners', version: '1' })
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
  description:
    'No active organisation context or enrolment not linked to apprentice account',
  type: ErrorResponseDto,
})
export class LearnersController {
  constructor(private readonly documentsService: LearnerDocumentsService) {}

  @Get('me/documents')
  @ResponseMessage('Learner documents retrieved successfully')
  @ApiOperation({
    summary: 'List my signed documents and accepted evidence',
    description:
      'Returns a unified document library for the authenticated apprentice user: ' +
      'signed commitment PDFs, completed review PDFs, and accepted portfolio evidence ' +
      '(metadata plus presigned download URLs for stored files). External link evidence ' +
      'includes externalUrl only. Optionally filter with ?enrolmentId= when the user has ' +
      'multiple active enrolments. Presigned URLs expire per S3_PRESIGN_DOWNLOAD_TTL_SECONDS.',
  })
  @ApiOkResponse({
    description: 'Document library grouped by enrolment',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(LearnerDocumentsResponseDto) },
      },
    },
  })
  listMyDocuments(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListLearnerDocumentsQueryDto,
  ): Promise<LearnerDocumentsResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.documentsService.listMyDocuments(user, query);
  }
}
