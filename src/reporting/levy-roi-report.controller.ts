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
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';
import { PdfJobResponseDto } from '../pdf/dto/pdf-job-response.dto.js';

import {
  LevyRoiBreakdownEntryResponseDto,
  LevyRoiForecastSliceDto,
  LevyRoiMonthlyContributionDto,
  LevyRoiReportResponseDto,
} from './dto/levy-roi-report-response.dto.js';
import { ListLevyRoiBreakdownQueryDto } from './dto/list-reporting-query.dto.js';
import { LevyRoiReportService } from './levy-roi-report.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Reporting')
@ApiExtraModels(
  LevyRoiReportResponseDto,
  LevyRoiForecastSliceDto,
  LevyRoiMonthlyContributionDto,
  LevyRoiBreakdownEntryResponseDto,
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
  constructor(private readonly levyRoiReportService: LevyRoiReportService) {}

  @Get()
  @ResponseMessage('Levy ROI report retrieved successfully')
  @ApiOperation({
    summary: 'Get levy ROI summary for the active employer organisation',
    description:
      'PRD F1.4.1 / F1.1.5 — aggregates DAS balance, forecast, surplus, enrolment counts, ' +
      'and v1 stub metrics (EPA pass rate, monthly contributions). Employer portal only.',
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
}
