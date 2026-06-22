import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
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
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import { DasFundingSyncService } from './das-funding-sync.service.js';
import { DasLevyForecastService } from './das-levy-forecast.service.js';
import { DasLevySyncService } from './das-levy-sync.service.js';
import { DasSyncDispatchService } from './das-sync-dispatch.service.js';
import {
  DasFundingPaymentResponseDto,
  ListDasFundingPaymentsQueryDto,
} from './dto/das-funding-payment-response.dto.js';
import { DasLevyBalanceResponseDto } from './dto/das-levy-balance-response.dto.js';
import { DasLevyForecastResponseDto } from './dto/das-levy-forecast-response.dto.js';
import { DasSyncResponseDto } from './dto/das-sync-response.dto.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('DAS')
@ApiExtraModels(
  DasSyncResponseDto,
  DasLevyBalanceResponseDto,
  DasLevyForecastResponseDto,
  DasFundingPaymentResponseDto,
)
@Controller({ path: 'das', version: '1' })
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
export class DasController {
  constructor(
    private readonly dispatch: DasSyncDispatchService,
    private readonly levySyncService: DasLevySyncService,
    private readonly levyForecastService: DasLevyForecastService,
    private readonly fundingSyncService: DasFundingSyncService,
  ) {}

  @Post('sync')
  @ResponseMessage('DAS sync job queued successfully')
  @ApiOperation({ summary: 'Queue manual DAS sync for active organisation' })
  @ApiCreatedResponse({
    description: 'Sync queued',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(DasSyncResponseDto) },
      },
    },
  })
  async queueSync(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DasSyncResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    const queued = await this.dispatch.enqueueSync({
      organisationId: user.organisationId!,
      requestedByUserId: user.id,
    });
    return { jobId: queued.jobId, status: 'queued' };
  }

  @Get('levy-balance')
  @ResponseMessage('DAS levy balance retrieved successfully')
  @ApiOperation({
    summary: 'Get latest persisted DAS levy balance for active organisation',
  })
  @ApiOkResponse({
    description: 'Latest persisted levy balance and sync metadata',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(DasLevyBalanceResponseDto) },
      },
    },
  })
  getLevyBalance(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DasLevyBalanceResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.levySyncService.getLatestForOrganisation(user.organisationId!);
  }

  @Get('levy-forecast')
  @ResponseMessage('DAS levy forecast retrieved successfully')
  @ApiOperation({
    summary: 'Get projected levy spend forecast for active organisation',
  })
  @ApiOkResponse({
    description: 'Levy forecast summary',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(DasLevyForecastResponseDto) },
      },
    },
  })
  getLevyForecast(
    @CurrentUser() user: AuthenticatedUser,
    @Query('horizonMonths') horizonMonths?: string,
  ): Promise<DasLevyForecastResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    const parsed = Number(horizonMonths ?? 12);
    return this.levyForecastService.forecastForOrganisation(
      user.organisationId!,
      Number.isNaN(parsed) ? 12 : parsed,
    );
  }

  @Get('funding-payments')
  @ResponseMessage('DAS funding payments retrieved successfully')
  @ApiOperation({
    summary: 'List persisted DAS funding payment confirmations',
    description:
      'PRD F1.1 / PRD-013 — Returns funding payments synced from the daily DAS batch for the active organisation. ' +
      'Optional from/to date filters; paginated.',
  })
  @ApiOkResponse({
    description: 'Paginated funding payments',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(DasFundingPaymentResponseDto) },
        },
      },
    },
  })
  async listFundingPayments(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListDasFundingPaymentsQueryDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    const result = await this.fundingSyncService.listPayments(
      user.organisationId!,
      query,
    );
    return new PaginatedResult(
      result.items.map((row) => ({
        id: row.id,
        paymentDate: row.paymentDate,
        amount: Number(row.amount),
        currency: row.currency,
        fundingPeriod: row.fundingPeriod,
        clawbackNotice: row.clawbackNotice,
        externalReference: row.externalReference,
        enrolmentId: row.enrolmentId,
      })),
      result.meta,
    );
  }
}
