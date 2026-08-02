import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  StreamableFile,
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
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';

import { Capability } from '../auth/capabilities/capability.enum.js';
import { RequiresCapability } from '../auth/capabilities/requires-capability.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ActiveOrganisationGuard } from '../auth/guards/active-organisation.guard.js';
import { CapabilityGuard } from '../auth/guards/capability.guard.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ORGANISATION_ID_HEADER } from '../common/constants/organisation-headers.js';
import { setCurrentUserId } from '../common/context/correlation-id-context.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { SkipResponseEnvelope } from '../common/interceptors/skip-response-envelope.decorator.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import { GenerateSarReportDto } from './dto/generate-sar-report.dto.js';
import { SarReportResponseDto } from './dto/sar-report-response.dto.js';
import { UpdateSarReportDto } from './dto/update-sar-report.dto.js';
import { SarDocxRenderer } from './sar-docx.renderer.js';
import { SarReportsService } from './sar-reports.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Ofsted')
@ApiExtraModels(SarReportResponseDto, GenerateSarReportDto, UpdateSarReportDto)
@Controller({ path: 'sar-reports', version: '1' })
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
export class SarReportsController {
  constructor(
    private readonly service: SarReportsService,
    private readonly docx: SarDocxRenderer,
  ) {}

  @Post()
  @UseGuards(CapabilityGuard)
  @RequiresCapability(Capability.MANAGE_SAR)
  @ResponseMessage('SAR draft generated successfully')
  @ApiOperation({
    summary: 'Generate a SAR draft for an academic year',
    description:
      'F2.1.3 AC1 — pre-populates each section from EIF scores, QIP ' +
      'progress, learner outcomes, review compliance and withdrawal rates. ' +
      'Idempotent: generating twice for the same year returns the existing ' +
      'draft rather than replacing the provider’s writing.',
  })
  @ApiCreatedResponse({
    description: 'The draft',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(SarReportResponseDto) },
      },
    },
  })
  generate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateSarReportDto,
  ): Promise<SarReportResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.service.generate(user, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List SAR reports, newest academic year first',
    description:
      'Readable by any org member — a self-assessment is a document staff ' +
      'are meant to have read.',
  })
  @ApiOkResponse({
    description: 'SAR reports',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(SarReportResponseDto) },
        },
      },
    },
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SarReportResponseDto[]> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.service.findAll(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one SAR report' })
  @ApiNotFoundResponse({ description: 'Not found', type: ErrorResponseDto })
  @ApiOkResponse({
    description: 'SAR report',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(SarReportResponseDto) },
      },
    },
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SarReportResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.service.findOne(user, id);
  }

  /**
   * AC3 — the draft is editable within the platform.
   *
   * Deliberately placed before `:id/lock` in the file for readability only;
   * the paths do not collide.
   */
  @Patch(':id')
  @UseGuards(CapabilityGuard)
  @RequiresCapability(Capability.MANAGE_SAR)
  @ResponseMessage('SAR draft updated successfully')
  @ApiOperation({
    summary: 'Edit section narratives and self-assessed grades',
    description:
      'Only narratives and grades can move. The section list itself comes ' +
      'from the template, so a client cannot invent or delete sections.',
  })
  @ApiConflictResponse({
    description: 'The report is locked',
    type: ErrorResponseDto,
  })
  @ApiOkResponse({
    description: 'Updated report',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(SarReportResponseDto) },
      },
    },
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSarReportDto,
  ): Promise<SarReportResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.service.update(user, id, dto);
  }

  @Post(':id/lock')
  @UseGuards(CapabilityGuard)
  @RequiresCapability(Capability.MANAGE_SAR)
  @ResponseMessage('SAR locked successfully')
  @ApiOperation({
    summary: 'Lock the SAR for its academic year',
    description:
      'F2.1.3 AC4 — freezes the figures as they stand now and makes the ' +
      'report immutable, in the database as well as the service. There is ' +
      'no unlock: a historical record that can be reopened is not one.',
  })
  @ApiConflictResponse({
    description: 'Already locked',
    type: ErrorResponseDto,
  })
  @ApiCreatedResponse({
    description: 'Locked report',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(SarReportResponseDto) },
      },
    },
  })
  lock(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SarReportResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.service.lock(user, id);
  }

  /**
   * AC3 — "exportable as Word document".
   *
   * Served inline rather than queued: the document is a few pages of text and
   * renders in milliseconds, so a job and a poll cycle would add failure
   * modes without buying anything. Same call the F1.4.2 CSV export makes.
   *
   * Open to any member who can read the report. A SAR is circulated to staff
   * and governors, and gating the download behind MANAGE_SAR would mean only
   * the two people who wrote it could send it to anyone.
   */
  @Get(':id/export')
  // Without this the global interceptor wraps the buffer in the JSON success
  // envelope and the browser saves a .docx that Word cannot open.
  @SkipResponseEnvelope()
  @ApiOperation({ summary: 'Download the SAR as a Word document' })
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  )
  @ApiOkResponse({
    description: 'Word document',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiNotFoundResponse({ description: 'Not found', type: ErrorResponseDto })
  async exportDocx(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);

    const content = await this.service.getExportContent(user, id);
    const buffer = await this.docx.render(content);

    // StreamableFile, not a bare Buffer. Nest serialises an unrecognised
    // return value with res.json(), which turns the document into
    // `{"type":"Buffer","data":[80,75,...]}` — a file that downloads, opens
    // in a text editor, and fails in Word.
    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      disposition: `attachment; filename="sar-${content.academicYear}.docx"`,
    });
  }
}
