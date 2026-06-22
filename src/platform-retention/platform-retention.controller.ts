import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { PaginationMetaDto } from '../common/dto/pagination-meta.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { PLATFORM_OPS_API_KEY_HEADER } from '../platform-gdpr/platform-gdpr.constants.js';
import { PlatformOpsApiKeyGuard } from '../platform-gdpr/platform-ops-api-key.guard.js';

import { RetentionRunResponseDto } from './dto/retention-run-response.dto.js';
import { PlatformRetentionService } from './platform-retention.service.js';

@ApiTags('platform-retention')
@ApiExtraModels(RetentionRunResponseDto, PaginationMetaDto)
@Controller({ path: 'platform/retention', version: '1' })
@UseGuards(PlatformOpsApiKeyGuard)
@SkipThrottle()
@ApiHeader({
  name: PLATFORM_OPS_API_KEY_HEADER,
  description: 'Shared secret for internal platform operations',
  required: true,
})
@ApiUnauthorizedResponse({
  description: 'Missing or invalid platform ops API key',
  type: ErrorResponseDto,
})
@ApiForbiddenResponse({
  description: 'Platform ops API is disabled or not configured',
  type: ErrorResponseDto,
})
export class PlatformRetentionController {
  constructor(private readonly retentionService: PlatformRetentionService) {}

  @Get('runs')
  @ResponseMessage('Retention run history retrieved successfully')
  @ApiOperation({
    summary: 'List GDPR retention job runs (platform ops)',
    description:
      'Returns paginated summaries of automated and manual retention purges. Requires `PLATFORM_OPS_ENABLED=true` and a valid ops API key.',
  })
  @ApiOkResponse({
    description: 'Paginated retention run history',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(RetentionRunResponseDto) },
        },
        meta: { $ref: getSchemaPath(PaginationMetaDto) },
      },
    },
  })
  listRuns(@Query() query: PaginationQueryDto) {
    return this.retentionService.listRuns(query);
  }

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Retention job completed successfully')
  @ApiOperation({
    summary: 'Run GDPR retention purge now (platform ops)',
    description:
      'Executes the retention purge immediately regardless of `CRON_RETENTION_ENABLED`. Records a manual run in history.',
  })
  @ApiOkResponse({
    description: 'Retention run summary',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(RetentionRunResponseDto) },
      },
    },
  })
  runManual() {
    return this.retentionService.runManual();
  }
}
