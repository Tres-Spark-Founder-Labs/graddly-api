import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
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
import { PaginationMetaDto } from '../common/dto/pagination-meta.dto.js';
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import { CommitmentStatementsService } from './commitment-statements.service.js';
import { CommitmentsCoSignService } from './commitments-co-sign.service.js';
import { CommitmentStatementContentDto } from './dto/commitment-statement-content.dto.js';
import { CommitmentStatementResponseDto } from './dto/commitment-statement-response.dto.js';
import { CreateCommitmentStatementDto } from './dto/create-commitment-statement.dto.js';
import { ListCommitmentStatementsQueryDto } from './dto/list-commitment-statements-query.dto.js';
import { SignCommitmentResponseDto } from './dto/sign-commitment-response.dto.js';
import { SignCommitmentDto } from './dto/sign-commitment.dto.js';
import { UpdateCommitmentStatementDto } from './dto/update-commitment-statement.dto.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import type { Request } from 'express';

@ApiTags('Commitment Statements')
@ApiExtraModels(
  CommitmentStatementResponseDto,
  CommitmentStatementContentDto,
  SignCommitmentResponseDto,
  PaginationMetaDto,
)
@Controller({ path: 'commitment-statements', version: '1' })
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
export class CommitmentsController {
  constructor(
    private readonly statementsService: CommitmentStatementsService,
    private readonly coSignService: CommitmentsCoSignService,
  ) {}

  @Post()
  @ResponseMessage('Commitment statement created successfully')
  @ApiOperation({ summary: 'Create commitment statement group and version 1' })
  @ApiCreatedResponse({
    description: 'Commitment statement created',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(CommitmentStatementResponseDto) },
      },
    },
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCommitmentStatementDto,
  ): Promise<CommitmentStatementResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.statementsService.create(user, dto);
  }

  @Get()
  @ResponseMessage('Commitment statements retrieved successfully')
  @ApiOperation({ summary: 'List commitment statement versions' })
  @ApiOkResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(CommitmentStatementResponseDto) },
        },
        meta: { $ref: getSchemaPath(PaginationMetaDto) },
      },
    },
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListCommitmentStatementsQueryDto,
  ): Promise<PaginatedResult<CommitmentStatementResponseDto>> {
    return this.statementsService.findAll(user, query);
  }

  @Post(':groupId/versions')
  @ResponseMessage('Commitment statement version created successfully')
  @ApiOperation({
    summary: 'Create a new version when current is signed or cancelled',
  })
  @ApiCreatedResponse({
    description: 'Commitment statement version created',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(CommitmentStatementResponseDto) },
      },
    },
  })
  createVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() dto: CreateCommitmentStatementDto,
  ): Promise<CommitmentStatementResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.statementsService.createVersion(user, groupId, dto);
  }

  @Get(':id')
  @ResponseMessage('Commitment statement retrieved successfully')
  @ApiOperation({ summary: 'Get a commitment statement version by id' })
  @ApiOkResponse({
    description: 'Commitment statement details',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(CommitmentStatementResponseDto) },
      },
    },
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CommitmentStatementResponseDto> {
    return this.statementsService.findOne(user, id);
  }

  @Patch(':id')
  @ResponseMessage('Commitment statement updated successfully')
  @ApiOperation({ summary: 'Update draft commitment statement content' })
  @ApiOkResponse({
    description: 'Updated commitment statement',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(CommitmentStatementResponseDto) },
      },
    },
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCommitmentStatementDto,
  ): Promise<CommitmentStatementResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.statementsService.update(user, id, dto);
  }

  @Post(':id/publish')
  @ResponseMessage('Commitment statement published successfully')
  @ApiOperation({
    summary: 'Publish draft statement (submitted + snapshot PDF enqueued)',
  })
  @ApiCreatedResponse({
    description: 'Commitment statement published',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(CommitmentStatementResponseDto) },
      },
    },
  })
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CommitmentStatementResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.statementsService.publish(user, id);
  }

  @Post(':id/cancel')
  @ResponseMessage('Commitment statement cancelled successfully')
  @ApiOperation({ summary: 'Cancel commitment statement from allowed states' })
  @ApiCreatedResponse({
    description: 'Commitment statement cancelled',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(CommitmentStatementResponseDto) },
      },
    },
  })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CommitmentStatementResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.statementsService.cancel(user, id);
  }

  @Post(':id/sign')
  @ResponseMessage('Commitment statement party signed successfully')
  @ApiOperation({
    summary:
      'Sign commitment as assigned party (apprentice → tutor → employer manager)',
  })
  @ApiCreatedResponse({
    description: 'Commitment statement signed',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(SignCommitmentResponseDto) },
      },
    },
  })
  sign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SignCommitmentDto,
    @Ip() clientIp: string,
    @Req() req: Request,
  ): Promise<SignCommitmentResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    const userAgent = req.headers['user-agent'];
    return this.coSignService.sign(
      user,
      id,
      dto,
      clientIp,
      typeof userAgent === 'string' ? userAgent : undefined,
    );
  }
}
