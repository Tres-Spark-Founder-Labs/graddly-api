import {
  ConflictException,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

import { DasApiActivityService } from './das-api-activity.service.js';
import { isDasManualMode } from './das-client.factory.js';
import { DasFundingSyncService } from './das-funding-sync.service.js';
import { DasLevyForecastService } from './das-levy-forecast.service.js';
import { DasLevySyncService } from './das-levy-sync.service.js';
import { DasSyncDispatchService } from './das-sync-dispatch.service.js';
import { DasSyncStatusService } from './das-sync-status.service.js';
import { DasApiActivityResponseDto } from './dto/das-api-activity-response.dto.js';
import {
  DasFundingPaymentResponseDto,
  ListDasFundingPaymentsQueryDto,
} from './dto/das-funding-payment-response.dto.js';
import { DasLevyBalanceResponseDto } from './dto/das-levy-balance-response.dto.js';
import { DasLevyForecastResponseDto } from './dto/das-levy-forecast-response.dto.js';
import { DasSyncResponseDto } from './dto/das-sync-response.dto.js';
import { DasSyncStatusResponseDto } from './dto/das-sync-status-response.dto.js';
import { ListDasActivityQueryDto } from './dto/list-das-activity-query.dto.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('DAS')
@ApiExtraModels(
  DasSyncResponseDto,
  DasLevyBalanceResponseDto,
  DasLevyForecastResponseDto,
  DasFundingPaymentResponseDto,
  DasSyncStatusResponseDto,
  DasApiActivityResponseDto,
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
    private readonly syncStatusService: DasSyncStatusService,
    private readonly activityService: DasApiActivityService,
    private readonly config: ConfigService,
  ) {}

  /**
   * F2.3.1 AC5 — "sync status indicator shows: last sync time, sync health
   * (green / amber / red), and error count".
   *
   * Open to any member rather than owner/admin: knowing whether the ESFA
   * integration is working is not a privileged act, and a tutor who cannot see
   * that sync is red will keep reporting the symptom instead of the cause.
   */
  @Get('sync-status')
  @ResponseMessage('DAS sync status retrieved successfully')
  @ApiOperation({ summary: 'Sync health, last sync time and error count' })
  @ApiOkResponse({
    description: 'Derived from the API activity log, never cached',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(DasSyncStatusResponseDto) },
      },
    },
  })
  async getSyncStatus(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DasSyncStatusResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.syncStatusService.getStatus(user.organisationId!);
  }

  /**
   * F2.3.1 AC7 — "full API activity log with each request, response code, and
   * any error messages".
   */
  @Get('activity')
  @ResponseMessage('DAS API activity retrieved successfully')
  @ApiOperation({ summary: 'Paginated log of every DAS API call' })
  @ApiOkResponse({
    description: 'Newest first. Credentials are redacted on write.',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(DasApiActivityResponseDto) },
        },
      },
    },
  })
  async listActivity(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListDasActivityQueryDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    const result = await this.activityService.list(user.organisationId!, query);
    return new PaginatedResult(
      result.items.map(
        (row): DasApiActivityResponseDto => ({
          id: row.id,
          operation: row.operation,
          method: row.method,
          url: row.url,
          responseStatus: row.responseStatus,
          succeeded: row.succeeded,
          durationMs: row.durationMs,
          errorMessage: row.errorMessage,
          requestSummary: row.requestSummary,
          triggeredByUserId: row.triggeredByUserId,
          occurredAt: row.createdAt.toISOString(),
        }),
      ),
      result.meta,
    );
  }

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
    /**
     * Refused outright when the platform is running on manually-entered data.
     *
     * Without this the sync runs, reads the manual row back through
     * `DasManualClient`, and `das-levy-sync.service.ts` stamps
     * `lastSyncStatus = SUCCESS` and `lastSyncedAt = now` over it. The card
     * then reads "Synced · 2 minutes ago" above a figure somebody typed weeks
     * ago — the sync did happen, but not with the apprenticeship service, and
     * that is the distinction the card exists to show.
     *
     * 409 rather than 404 or 501: the endpoint exists and the request is
     * well-formed, but it conflicts with the current state of the integration.
     * The message names the route that does work.
     */
    if (isDasManualMode(this.config)) {
      throw new ConflictException(
        'DAS is running in manual mode, so there is nothing to sync. ' +
          'Update the figures under Settings → Levy data instead.',
      );
    }

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
