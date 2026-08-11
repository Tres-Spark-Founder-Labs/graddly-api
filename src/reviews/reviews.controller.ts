import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
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
import { LearnerAccessible } from '../common/learner-scope/learner-accessible.decorator.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';
import { PdfJobResponseDto } from '../pdf/dto/pdf-job-response.dto.js';

import { BulkScheduleFromEnrolmentsDto } from './dto/bulk-schedule-from-enrolments.dto.js';
import { BulkScheduleReviewsResponseDto } from './dto/bulk-schedule-reviews-response.dto.js';
import { BulkScheduleReviewsDto } from './dto/bulk-schedule-reviews.dto.js';
import { CreateReviewDto } from './dto/create-review.dto.js';
import { ListReviewsQueryDto } from './dto/list-reviews-query.dto.js';
import { ReviewRecordResponseDto } from './dto/review-record-response.dto.js';
import { ReviewResponseDto } from './dto/review-response.dto.js';
import { SignReviewResponseDto } from './dto/sign-review-response.dto.js';
import { SignReviewDto } from './dto/sign-review.dto.js';
import { UpdateReviewDto } from './dto/update-review.dto.js';
import { UpsertReviewRecordDto } from './dto/upsert-review-record.dto.js';
import { ReviewRecordsService } from './review-records.service.js';
import { ReviewsCoSignService } from './reviews-co-sign.service.js';
import { ReviewsSnapshotService } from './reviews-snapshot.service.js';
import { ReviewsService } from './reviews.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import type { Request } from 'express';

@ApiTags('Reviews')
@ApiExtraModels(
  ReviewResponseDto,
  ReviewRecordResponseDto,
  BulkScheduleReviewsResponseDto,
  SignReviewResponseDto,
  PdfJobResponseDto,
  PaginationMetaDto,
)
@Controller({ path: 'reviews', version: '1' })
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
export class ReviewsController {
  constructor(
    private readonly reviewsService: ReviewsService,
    private readonly recordsService: ReviewRecordsService,
    private readonly snapshotService: ReviewsSnapshotService,
    private readonly coSignService: ReviewsCoSignService,
  ) {}

  @Post()
  @ResponseMessage('Review scheduled successfully')
  @ApiOperation({ summary: 'Schedule a review' })
  @ApiCreatedResponse({
    description: 'Review scheduled',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(ReviewResponseDto) },
      },
    },
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateReviewDto,
  ): Promise<ReviewResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.reviewsService.create(user, dto);
  }

  @Post('bulk-schedule')
  @ResponseMessage('Bulk review scheduling completed')
  @ApiOperation({ summary: 'Bulk schedule reviews (max 20)' })
  @ApiCreatedResponse({
    description: 'Bulk scheduling result',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(BulkScheduleReviewsResponseDto) },
      },
    },
  })
  bulkSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkScheduleReviewsDto,
  ): Promise<BulkScheduleReviewsResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.reviewsService.bulkSchedule(user, dto.items);
  }

  /**
   * F2.2.3 AC2 — "set review dates for multiple learners simultaneously".
   *
   * The sibling above takes full review items, each naming four ids the
   * caller must resolve first. Workable for one review, not for thirty —
   * which is why nothing had ever called it. This asks for what a provider
   * knows (these learners, this date) and derives the participants from each
   * enrolment.
   */
  @Post('bulk-schedule/from-enrolments')
  @ResponseMessage('Bulk review scheduling completed')
  @ApiOperation({
    summary: 'Bulk schedule one date across enrolments (max 20)',
    description:
      'Derives apprentice, tutor and employer manager from each enrolment. ' +
      'An enrolment missing a participant is reported as a per-learner ' +
      'failure rather than failing the batch.',
  })
  @ApiCreatedResponse({
    description: 'Bulk scheduling result',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(BulkScheduleReviewsResponseDto) },
      },
    },
  })
  bulkScheduleFromEnrolments(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkScheduleFromEnrolmentsDto,
  ): Promise<BulkScheduleReviewsResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.reviewsService.bulkScheduleFromEnrolments(user, dto);
  }

  @Get('calendar')
  @ResponseMessage('Review calendar retrieved successfully')
  @ApiOperation({
    summary: 'List reviews in a date range (calendar view)',
  })
  @ApiOkResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(ReviewResponseDto) },
        },
        meta: { $ref: getSchemaPath(PaginationMetaDto) },
      },
    },
  })
  findCalendar(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListReviewsQueryDto,
  ): Promise<PaginatedResult<ReviewResponseDto>> {
    if (!query.from || !query.to) {
      throw new BadRequestException(
        'Query parameters from and to are required for calendar view',
      );
    }
    return this.reviewsService.findAll(user, query);
  }

  @LearnerAccessible()
  @Get()
  @ResponseMessage('Reviews retrieved successfully')
  @ApiOperation({ summary: 'List reviews with filters' })
  @ApiOkResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(ReviewResponseDto) },
        },
        meta: { $ref: getSchemaPath(PaginationMetaDto) },
      },
    },
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListReviewsQueryDto,
  ): Promise<PaginatedResult<ReviewResponseDto>> {
    return this.reviewsService.findAll(user, query);
  }

  @LearnerAccessible()
  @Get(':id')
  @ResponseMessage('Review retrieved successfully')
  @ApiOperation({ summary: 'Get a review by id' })
  @ApiOkResponse({
    description: 'Review details',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(ReviewResponseDto) },
      },
    },
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReviewResponseDto> {
    return this.reviewsService.findOne(user, id);
  }

  @Patch(':id')
  @ResponseMessage('Review updated successfully')
  @ApiOperation({ summary: 'Update or reschedule a review' })
  @ApiOkResponse({
    description: 'Updated review',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(ReviewResponseDto) },
      },
    },
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReviewDto,
  ): Promise<ReviewResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.reviewsService.update(user, id, dto);
  }

  @Put(':id/record')
  @ResponseMessage('Review record saved successfully')
  @ApiOperation({ summary: 'Create or update review record payload' })
  @ApiOkResponse({
    description: 'Review record saved',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(ReviewRecordResponseDto) },
      },
    },
  })
  upsertRecord(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertReviewRecordDto,
  ): Promise<ReviewRecordResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.recordsService.upsert(user, id, dto);
  }

  @Get(':id/record')
  @ResponseMessage('Review record retrieved successfully')
  @ApiOperation({ summary: 'Get review record payload' })
  @ApiOkResponse({
    description: 'Review record details',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(ReviewRecordResponseDto) },
      },
    },
  })
  getRecord(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReviewRecordResponseDto> {
    return this.recordsService.findOne(user, id);
  }

  /**
   * F2.2.3 AC4 — the goals agreed at the previous review, so the tutor can
   * record progress against them rather than retyping from a PDF.
   *
   * Empty list on a first review: having nothing to look back on is a normal
   * state at the start of an apprenticeship, not an error.
   */
  @Get(':id/previous-goals')
  @ResponseMessage('Previous review goals retrieved successfully')
  @ApiOperation({
    summary: "SMART goals from this enrolment's last completed review",
  })
  @ApiOkResponse({
    description: 'Previous goals (empty when there is no earlier review)',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: { objective: { type: 'string' } },
          },
        },
      },
    },
  })
  getPreviousGoals(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ objective: string }[]> {
    return this.recordsService.previousGoals(user, id);
  }

  @Post(':id/snapshot-pdf')
  @ResponseMessage('Review snapshot PDF job requested')
  @ApiOperation({ summary: 'Enqueue review snapshot PDF generation' })
  @ApiCreatedResponse({
    description: 'Queued PDF generation job',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(PdfJobResponseDto) },
      },
    },
  })
  requestSnapshot(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PdfJobResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.snapshotService.requestSnapshot(user, id);
  }

  @LearnerAccessible()
  @Post(':id/sign')
  @ResponseMessage('Review party signed successfully')
  @ApiOperation({
    summary:
      'Sign review as assigned party (apprentice → tutor → employer manager)',
  })
  @ApiCreatedResponse({
    description: 'Review signed',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(SignReviewResponseDto) },
      },
    },
  })
  sign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SignReviewDto,
    @Ip() clientIp: string,
    @Req() req: Request,
  ): Promise<SignReviewResponseDto> {
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
