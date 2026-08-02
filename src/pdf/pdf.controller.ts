import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
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
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ActiveOrganisationGuard } from '../auth/guards/active-organisation.guard.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ORGANISATION_ID_HEADER } from '../common/constants/organisation-headers.js';
import { setCurrentUserId } from '../common/context/correlation-id-context.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { SkipResponseEnvelope } from '../common/interceptors/skip-response-envelope.decorator.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import { CreatePdfJobDto } from './dto/create-pdf-job.dto.js';
import { PdfJobResponseDto } from './dto/pdf-job-response.dto.js';
import { PdfJobsService } from './pdf-jobs.service.js';
import { PdfService } from './pdf.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('PDF')
@ApiExtraModels(PdfJobResponseDto, CreatePdfJobDto)
@Controller({ path: 'pdf', version: '1' })
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
export class PdfController {
  constructor(
    private readonly pdfService: PdfService,
    private readonly pdfJobsService: PdfJobsService,
  ) {}

  @Post('jobs')
  @ResponseMessage('PDF job queued successfully')
  @ApiOperation({ summary: 'Queue async PDF generation' })
  @ApiCreatedResponse({
    description: 'Queued PDF job',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(PdfJobResponseDto) },
      },
    },
  })
  createJob(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePdfJobDto,
  ): Promise<PdfJobResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.pdfJobsService.create(user, dto);
  }

  /**
   * Polling this route is the documented way to consume an async export, so
   * it should not share the ordinary request budget.
   *
   * At the default 100/minute a single 2-second poll spends 30 of them, and a
   * second export plus normal page traffic tipped real users into
   * `429 ThrottlerException` — the poll then fails, the job never reads as
   * complete, and the button waits forever on a PDF that is sitting ready in
   * storage.
   *
   * A single indexed read by primary key is cheap enough to allow generously.
   * The client also backs off and gives up after three minutes, so this
   * ceiling is a safety net rather than the mechanism.
   */
  @Get('jobs/:id')
  @Throttle({ default: { ttl: 60_000, limit: 600 } })
  @ResponseMessage('PDF job retrieved successfully')
  @ApiOperation({ summary: 'Get PDF job status (poll until completed)' })
  @ApiOkResponse({
    description: 'PDF job status',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(PdfJobResponseDto) },
      },
    },
  })
  getJob(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PdfJobResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.pdfJobsService.findOne(user, id);
  }

  @Get('hello')
  @SkipResponseEnvelope()
  @Header('Content-Type', 'application/pdf')
  @ApiOperation({
    summary: 'Generate a sync hello PDF (pdfkit baseline proof)',
  })
  @ApiProduces('application/pdf')
  @ApiOkResponse({
    description: 'PDF file bytes',
    schema: { type: 'string', format: 'binary' },
  })
  async hello(@CurrentUser() user: AuthenticatedUser): Promise<StreamableFile> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    const buffer = await this.pdfService.renderHelloPdf();
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: 'inline; filename="hello.pdf"',
    });
  }
}
