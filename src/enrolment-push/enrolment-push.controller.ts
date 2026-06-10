import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNoContentResponse,
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
import { PaginationMetaDto } from '../common/dto/pagination-meta.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import { EnrolmentSubmissionPushResponseDto } from './dto/enrolment-submission-push-response.dto.js';
import { EnrolmentPushService } from './enrolment-push.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Enrolment Push')
@ApiExtraModels(EnrolmentSubmissionPushResponseDto, PaginationMetaDto)
@Controller({ path: 'enrolment-pushes', version: '1' })
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
export class EnrolmentPushController {
  constructor(private readonly service: EnrolmentPushService) {}

  @Get('failed')
  @ResponseMessage('Failed enrolment submission pushes retrieved successfully')
  @ApiOperation({
    summary: 'List failed DAS enrolment submission push records',
    description:
      'Returns pushes that failed after BullMQ retries. Use POST /:id/retry to re-queue delivery to DAS.',
  })
  @ApiOkResponse({
    description: 'Paginated failed push records',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(EnrolmentSubmissionPushResponseDto) },
        },
        meta: { $ref: getSchemaPath(PaginationMetaDto) },
      },
    },
  })
  listFailed(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResult<EnrolmentSubmissionPushResponseDto>> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.service.listFailed(user, query);
  }

  @Get(':id')
  @ResponseMessage('Enrolment submission push record retrieved successfully')
  @ApiOperation({
    summary: 'Get DAS enrolment submission push record by id',
    description:
      'Poll push status after ILR learner record create or ESFA submit. Status lifecycle: queued → processing → delivered | failed.',
  })
  @ApiOkResponse({
    description: 'Enrolment submission push record',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(EnrolmentSubmissionPushResponseDto) },
      },
    },
  })
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EnrolmentSubmissionPushResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.service.getOne(user, id);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseMessage('Enrolment submission push retry queued successfully')
  @ApiOperation({
    summary: 'Manually retry a failed DAS enrolment submission push',
  })
  @ApiNoContentResponse({ description: 'Retry queued' })
  async retry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    await this.service.retryFailed(user, id);
  }
}
