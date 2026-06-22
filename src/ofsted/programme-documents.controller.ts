import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
  getSchemaPath,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ActiveOrganisationGuard } from '../auth/guards/active-organisation.guard.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ORGANISATION_ID_HEADER } from '../common/constants/organisation-headers.js';
import { setCurrentUserId } from '../common/context/correlation-id-context.js';
import {
  ErrorResponseDto,
  ValidationErrorResponseDto,
} from '../common/dto/error-response.dto.js';
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import { CreateProgrammeDocumentDto } from './dto/create-programme-document.dto.js';
import { ProgrammeDocumentResponseDto } from './dto/programme-document-response.dto.js';
import { ProgrammeDocumentsService } from './programme-documents.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Programmes')
@ApiExtraModels(ProgrammeDocumentResponseDto, CreateProgrammeDocumentDto)
@Controller({ path: 'programmes/:programmeId/documents', version: '1' })
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
export class ProgrammeDocumentsController {
  constructor(private readonly documentsService: ProgrammeDocumentsService) {}

  @Get()
  @ResponseMessage('Programme documents retrieved successfully')
  @ApiOperation({
    summary: 'List EIF programme documents',
    description:
      'Returns curriculum_map, assessment_strategy, and industry_engagement uploads ' +
      'for the programme. Document coverage across active programmes feeds the EIF curriculum intent score.',
  })
  @ApiOkResponse({
    description: 'Programme documents',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(ProgrammeDocumentResponseDto) },
        },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Programme not found in active organisation',
    type: ErrorResponseDto,
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('programmeId', ParseUUIDPipe) programmeId: string,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.documentsService.listForProgramme(user, programmeId);
  }

  @Post()
  @ResponseMessage('Programme document attached successfully')
  @ApiOperation({
    summary: 'Attach a programme document',
    description:
      'Registers metadata for a required programme document type. One document per type per programme. ' +
      'Invalidates the EIF score cache for the organisation.',
  })
  @ApiCreatedResponse({
    description: 'Document attached',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(ProgrammeDocumentResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Programme not found',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Document type already exists for programme',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  attach(
    @CurrentUser() user: AuthenticatedUser,
    @Param('programmeId', ParseUUIDPipe) programmeId: string,
    @Body() dto: CreateProgrammeDocumentDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.documentsService.attach(user, programmeId, dto);
  }
}
