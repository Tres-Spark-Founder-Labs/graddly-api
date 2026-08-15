import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
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
import { CreateTransferFromMatchDto } from '../dto/create-transfer-from-match.dto.js';
import { LevyTransferDocumentResponseDto } from '../dto/levy-transfer-document-response.dto.js';
import { LevyTransferResponseDto } from '../dto/levy-transfer-response.dto.js';
import { LinkTransferEnrolmentDto } from '../dto/link-transfer-enrolment.dto.js';
import { ListTransfersQueryDto } from '../dto/list-transfers-query.dto.js';
import { SignTransferResponseDto } from '../dto/sign-transfer-response.dto.js';
import { SignTransferDto } from '../dto/sign-transfer.dto.js';
import { TransferEnrolmentResponseDto } from '../dto/transfer-enrolment-response.dto.js';
import { LevyTransferEnrolment } from '../entities/levy-transfer-enrolment.entity.js';
import { LevyTransferFundingService } from '../services/levy-transfer-funding.service.js';
import { LevyTransferService } from '../services/levy-transfer.service.js';

import type { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface.js';
import type { Request } from 'express';

/**
 * The entity carries `createdAt` as a `Date`; the response contract says
 * ISO-8601 string. Mapped explicitly rather than cast — a cast would have
 * silently shipped a `Date` wherever the serialiser happened not to convert
 * it, and the generated client typings would have been wrong about it.
 */
function toTransferEnrolmentDto(
  link: LevyTransferEnrolment,
): TransferEnrolmentResponseDto {
  return {
    id: link.id,
    transferId: link.transferId,
    enrolmentId: link.enrolmentId,
    donorOrganisationId: link.donorOrganisationId,
    attributedAmount: link.attributedAmount,
    createdAt: link.createdAt.toISOString(),
  };
}

@ApiTags('Levy Exchange')
@ApiExtraModels(
  LevyTransferResponseDto,
  LevyTransferDocumentResponseDto,
  SignTransferResponseDto,
  CreateTransferFromMatchDto,
  SignTransferDto,
  ListTransfersQueryDto,
  PaginationMetaDto,
)
@Controller({ path: 'levy-exchange/transfers', version: '1' })
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
export class TransfersController {
  constructor(
    private readonly transferService: LevyTransferService,
    private readonly fundingService: LevyTransferFundingService,
  ) {}

  @Post()
  @ResponseMessage('Levy transfer created successfully')
  @ApiOperation({
    summary: 'Create levy transfer from confirmed match',
    description:
      'Creates a draft transfer and enqueues the agreement PDF. Match application must be confirmed.',
  })
  @ApiBadRequestResponse({
    description: 'Match application not confirmed or transfer already exists',
    type: ErrorResponseDto,
  })
  @ApiCreatedResponse({
    description: 'Levy transfer created',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(LevyTransferResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  createFromMatch(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTransferFromMatchDto,
  ): Promise<LevyTransferResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.transferService.createFromMatch(user, dto);
  }

  @Get()
  @ResponseMessage('Levy transfers retrieved successfully')
  @ApiOperation({
    summary: 'List levy transfers for active organisation',
    description:
      'Returns transfers where the active organisation is donor or recipient, ' +
      'newest first. Filter with role=donor|recipient and/or status.',
  })
  @ApiOkResponse({
    description: 'Paginated levy transfers',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(LevyTransferResponseDto) },
        },
        meta: { $ref: getSchemaPath(PaginationMetaDto) },
      },
    },
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListTransfersQueryDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.transferService.list(user.organisationId!, query);
  }

  @Get(':id')
  @ResponseMessage('Levy transfer retrieved successfully')
  @ApiOperation({ summary: 'Get levy transfer by id' })
  @ApiOkResponse({
    description: 'Levy transfer detail',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(LevyTransferResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Levy transfer not found',
    type: ErrorResponseDto,
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LevyTransferResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.transferService.findOne(user, id);
  }

  @Post(':id/sign')
  @ResponseMessage('Levy transfer party signed successfully')
  @ApiOperation({
    summary: 'Sign levy transfer agreement (donor then recipient)',
    description:
      'Records bilateral e-signatures. Donor must sign before recipient. ' +
      'Both parties must sign before POST /levy-exchange/transfers/{id}/submit.',
  })
  @ApiBadRequestResponse({
    description:
      'Wrong signing order, transfer closed, or invalid signature key',
    type: ErrorResponseDto,
  })
  @ApiCreatedResponse({
    description: 'Party signed',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(SignTransferResponseDto) },
      },
    },
  })
  sign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SignTransferDto,
    @Ip() clientIp: string,
    @Req() req: Request,
  ): Promise<SignTransferResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    const userAgent = req.headers['user-agent'];
    return this.transferService.sign(
      user,
      id,
      dto,
      clientIp,
      typeof userAgent === 'string' ? userAgent : undefined,
    );
  }

  @Post(':id/submit')
  @ResponseMessage('Levy transfer submitted to DAS successfully')
  @ApiOperation({
    summary: 'Submit signed levy transfer to DAS',
    description:
      'Submits the fully signed transfer to ESFA DAS. Donor organisation only; ' +
      'requires both signatures and a generated agreement PDF.',
  })
  @ApiBadRequestResponse({
    description:
      'Transfer not fully signed, wrong organisation, or DAS submission failed',
    type: ErrorResponseDto,
  })
  @ApiCreatedResponse({
    description: 'Transfer submitted',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(LevyTransferResponseDto) },
      },
    },
  })
  submitToDas(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LevyTransferResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.transferService.submitToDas(user, id);
  }

  @Get(':id/document')
  @ResponseMessage('Levy transfer document retrieved successfully')
  @ApiOperation({
    summary: 'Get levy transfer agreement document',
    description:
      'Returns PDF metadata and storage key for the transfer agreement. ' +
      'Available after PDF generation completes.',
  })
  @ApiNotFoundResponse({
    description: 'Transfer or document not found',
    type: ErrorResponseDto,
  })
  @ApiOkResponse({
    description: 'Transfer document',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(LevyTransferDocumentResponseDto) },
      },
    },
  })
  getDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LevyTransferDocumentResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.transferService.getDocument(user, id);
  }

  /**
   * F4.1.4 AC1 — which learners a transfer funded.
   *
   * Lives on the transfer rather than on the enrolment because the transfer is
   * what all three interested parties have in common: the donor who paid, the
   * SME whose learner it is, and the provider delivering the training. Who can
   * see which rows is decided by the row-level security policy on
   * `levy_transfer_enrolments`, not here.
   */
  @Post(':id/enrolments')
  @ResponseMessage('Enrolment linked to transfer successfully')
  @ApiOperation({
    summary: 'Record that this transfer funded an enrolment',
    description:
      'Called by the provider delivering the training. The transfer must be ' +
      'confirmed or active, and the enrolment must belong to the employer ' +
      'that received the transfer. Idempotent — linking the same pair twice ' +
      'returns the existing link rather than double-counting the learner.',
  })
  @ApiBadRequestResponse({
    description:
      'Transfer is not yet funding, or the enrolment belongs to another employer',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Transfer or enrolment not found',
    type: ErrorResponseDto,
  })
  @ApiCreatedResponse({
    description: 'Enrolment linked',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(TransferEnrolmentResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  async linkEnrolment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkTransferEnrolmentDto,
  ): Promise<TransferEnrolmentResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    const link = await this.fundingService.link({
      transferId: id,
      enrolmentId: dto.enrolmentId,
      attributedAmount:
        dto.attributedAmount !== undefined
          ? String(dto.attributedAmount)
          : null,
    });
    return toTransferEnrolmentDto(link);
  }

  @Get(':id/enrolments')
  @ResponseMessage('Transfer enrolments retrieved successfully')
  @ApiOperation({
    summary: 'List the enrolments this transfer funded',
  })
  @ApiOkResponse({
    description: 'Funded enrolments',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(TransferEnrolmentResponseDto) },
        },
      },
    },
  })
  async listEnrolments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TransferEnrolmentResponseDto[]> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    const links = await this.fundingService.listForTransfer(id);
    return links.map(toTransferEnrolmentDto);
  }

  @Delete(':id/enrolments/:enrolmentId')
  @ResponseMessage('Enrolment unlinked from transfer successfully')
  @ApiOperation({
    summary: 'Remove a funding link recorded in error',
    description:
      'Soft-deletes the link. The enrolment and the transfer are untouched — ' +
      'only the claim that this transfer paid for that learner is withdrawn.',
  })
  @ApiNotFoundResponse({
    description: 'No such link',
    type: ErrorResponseDto,
  })
  async unlinkEnrolment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('enrolmentId', ParseUUIDPipe) enrolmentId: string,
  ): Promise<void> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    await this.fundingService.unlink(id, enrolmentId);
  }
}
