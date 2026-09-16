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

import { WithdrawalCompletionPushResponseDto } from './dto/withdrawal-completion-push-response.dto.js';
import { WithdrawalPushService } from './withdrawal-push.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Withdrawal Push')
@ApiExtraModels(WithdrawalCompletionPushResponseDto, PaginationMetaDto)
@Controller({ path: 'withdrawal-pushes', version: '1' })
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
export class WithdrawalPushController {
  constructor(private readonly service: WithdrawalPushService) {}

  @Get('failed')
  @ResponseMessage('Failed withdrawal pushes retrieved successfully')
  @ApiOperation({ summary: 'List failed withdrawal completion push records' })
  @ApiOkResponse({
    description: 'Paginated failed push records',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(WithdrawalCompletionPushResponseDto) },
        },
        meta: { $ref: getSchemaPath(PaginationMetaDto) },
      },
    },
  })
  listFailed(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResult<WithdrawalCompletionPushResponseDto>> {
    setCurrentUserId(user.id);
    return this.service.listFailed(user, query);
  }

  @Get(':id')
  @ResponseMessage('Withdrawal push record retrieved successfully')
  @ApiOperation({ summary: 'Get withdrawal completion push record by id' })
  @ApiOkResponse({
    description: 'Withdrawal completion push record',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(WithdrawalCompletionPushResponseDto) },
      },
    },
  })
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WithdrawalCompletionPushResponseDto> {
    setCurrentUserId(user.id);
    return this.service.getOne(user, id);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseMessage('Withdrawal push retry queued successfully')
  @ApiOperation({
    summary: 'Manually retry a failed withdrawal completion push',
  })
  @ApiNoContentResponse({ description: 'Retry queued' })
  async retry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    setCurrentUserId(user.id);
    await this.service.retryFailed(user, id);
  }
}
