import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { ActiveOrganisationGuard } from '../auth/guards/active-organisation.guard.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ORGANISATION_ID_HEADER } from '../common/constants/organisation-headers.js';
import { setCurrentUserId } from '../common/context/correlation-id-context.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { SkipResponseEnvelope } from '../common/interceptors/skip-response-envelope.decorator.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';
import { OrganisationRole } from '../organisations/organisation-role.enum.js';
import { PdfJobResponseDto } from '../pdf/dto/pdf-job-response.dto.js';

import {
  LevyRoiBreakdownEntryResponseDto,
  LevyRoiForecastSliceDto,
  LevyRoiMonthlyContributionDto,
  LevyRoiPeriodDto,
  LevyRoiReportResponseDto,
  LevyRoiYearOnYearDto,
} from './dto/levy-roi-report-response.dto.js';
import { ListLevyRoiBreakdownQueryDto } from './dto/list-reporting-query.dto.js';
import {
  ReportSubscriberDto,
  SetReportSubscribersDto,
} from './dto/report-subscription.dto.js';
import { LevyRoiReportService } from './levy-roi-report.service.js';
import { ReportSubscriptionsService } from './report-subscriptions.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import type { Response } from 'express';

@ApiTags('Reporting')
@ApiExtraModels(
  LevyRoiReportResponseDto,
  LevyRoiForecastSliceDto,
  LevyRoiMonthlyContributionDto,
  LevyRoiBreakdownEntryResponseDto,
  LevyRoiPeriodDto,
  LevyRoiYearOnYearDto,
  ReportSubscriberDto,
  PdfJobResponseDto,
)
@Controller({ path: 'reporting/levy-roi', version: '1' })
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
  description: 'Requires employer portal organisation or no active org context',
  type: ErrorResponseDto,
})
export class LevyRoiReportController {
  constructor(
    private readonly levyRoiReportService: LevyRoiReportService,
    private readonly subscriptionsService: ReportSubscriptionsService,
  ) {}

  @Get()
  @ResponseMessage('Levy ROI report retrieved successfully')
  @ApiOperation({
    summary: 'Get levy ROI summary for the active employer organisation',
    description:
      'PRD F1.4.1 / F1.1.5 — aggregates DAS balance, forecast, surplus, ' +
      'enrolment counts, EPA pass rate (from recorded assessment outcomes) ' +
      'and the year-on-year comparison. Employer portal only. ' +
      '`totalLevySpendToDate` remains a proxy: latest DAS balance plus ' +
      'confirmed outbound transfers, pending true contribution history.',
  })
  @ApiOkResponse({
    description: 'Levy ROI summary JSON',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(LevyRoiReportResponseDto) },
      },
    },
  })
  getSummary(@CurrentUser() user: AuthenticatedUser) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.levyRoiReportService.getSummary(user.organisationId!);
  }

  @Get('breakdown')
  @ResponseMessage('Levy ROI breakdown retrieved successfully')
  @ApiOperation({
    summary: 'Side-by-side levy ROI breakdown by provider or standard',
    description:
      'PRD F1.4.1 provider/standard comparison table. Employer portal only.',
  })
  @ApiOkResponse({
    description: 'Breakdown rows',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(LevyRoiBreakdownEntryResponseDto) },
        },
      },
    },
  })
  getBreakdown(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListLevyRoiBreakdownQueryDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.levyRoiReportService.getBreakdown(
      user.organisationId!,
      query.groupBy,
    );
  }

  @Post('export')
  @ResponseMessage('Levy ROI PDF export queued successfully')
  @ApiOperation({
    summary: 'Queue async board-ready levy ROI PDF export',
    description:
      'PRD F1.1.5 — enqueues a PDF job via the shared PdfModule pipeline. ' +
      'Poll GET /pdf/jobs/:id or use the e2e processPdfJobInApp helper in tests.',
  })
  @ApiCreatedResponse({
    description: 'Queued PDF generation job',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(PdfJobResponseDto) },
      },
    },
  })
  exportPdf(@CurrentUser() user: AuthenticatedUser) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.levyRoiReportService.exportPdf(user);
  }

  /**
   * F1.4.2 AC3 — CSV, served inline rather than queued.
   *
   * Separate from `/breakdown?format=csv` because the comparison is its own
   * artefact with its own column set, and overloading a JSON endpoint with a
   * response type that changes shape is how the audit export ended up
   * needing a type guard at the controller.
   */
  @Get('provider-comparison.csv')
  @ApiOperation({
    summary: 'Provider performance comparison as CSV',
    description:
      'F1.4.2 AC3. Every metric is calculated from platform data — ' +
      'off-the-job logs, scheduled reviews, recorded EPA outcomes and ' +
      'enrolment status — never self-reported by the provider (AC2). Blank ' +
      'cells mean a metric cannot be calculated yet, not zero.',
  })
  // F1.4.2 fix. Without this the global interceptor wraps the CSV string in
  // the JSON success envelope, so the "download" saves a .csv file whose
  // first line is `{"message":"Success","data":"Provider,Active…`. The
  // interceptor's only other escape hatch is a hardcoded `/audit/export` URL
  // check, which this route does not match.
  @SkipResponseEnvelope()
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'CSV file',
    schema: { type: 'string', format: 'binary' },
  })
  async exportComparisonCsv(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);

    const csv = await this.levyRoiReportService.exportComparisonCsv(
      user.organisationId!,
    );
    const today = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="provider-comparison-${today}.csv"`,
    );
    return csv;
  }

  @Post('provider-comparison/export')
  @ResponseMessage('Provider comparison PDF export queued successfully')
  @ApiOperation({
    summary: 'Queue the provider performance comparison as PDF',
    description:
      'F1.4.2 AC3 — a standalone comparison document, not the breakdown ' +
      'section of the levy report. Poll `GET /pdf/jobs/{jobId}`.',
  })
  @ApiCreatedResponse({
    description: 'Queued PDF generation job',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(PdfJobResponseDto) },
      },
    },
  })
  exportComparisonPdf(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PdfJobResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.levyRoiReportService.exportComparisonPdf(user);
  }

  @Get('subscribers')
  @ResponseMessage('Report subscribers retrieved successfully')
  @ApiOperation({
    summary: 'Who receives the scheduled monthly levy ROI report',
    description: 'F1.4.1 AC5 — the distribution list for the monthly email.',
  })
  @ApiOkResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(ReportSubscriberDto) },
        },
      },
    },
  })
  listSubscribers(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReportSubscriberDto[]> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.subscriptionsService.list(user.organisationId!);
  }

  /**
   * Owner/admin only. The report aggregates apprentice-level outcomes across
   * the whole organisation, so deciding who it is emailed to is an
   * administrative act, not something any member should be able to change.
   */
  @Put('subscribers')
  @UseGuards(RolesGuard)
  @Roles(OrganisationRole.OWNER, OrganisationRole.ADMIN)
  @ResponseMessage('Report subscribers updated successfully')
  @ApiOperation({
    summary: 'Replace the monthly levy ROI report distribution list',
    description:
      'F1.4.1 AC5 — recipients must be active members of the organisation. ' +
      'The list is replaced wholesale; an empty array stops delivery.',
  })
  @ApiOkResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(ReportSubscriberDto) },
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'One or more user ids are not active members',
    type: ErrorResponseDto,
  })
  setSubscribers(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetReportSubscribersDto,
  ): Promise<ReportSubscriberDto[]> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.subscriptionsService.replace(
      user.organisationId!,
      dto.userIds,
      user.id,
    );
  }
}
