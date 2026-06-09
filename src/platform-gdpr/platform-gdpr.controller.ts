import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiExtraModels,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';

import { ErasureRequestDto } from './dto/erasure-request.dto.js';
import { ErasureResponseDto } from './dto/erasure-response.dto.js';
import { ErasureService } from './erasure.service.js';
import { PlatformOpsApiKeyGuard } from './platform-ops-api-key.guard.js';

@ApiTags('platform-gdpr')
@ApiExtraModels(ErasureResponseDto)
@Controller('platform/gdpr')
@UseGuards(PlatformOpsApiKeyGuard)
@SkipThrottle()
@ApiHeader({
  name: 'X-Platform-Ops-Api-Key',
  description: 'Shared secret for internal GDPR operations',
  required: true,
})
@ApiUnauthorizedResponse({
  description: 'Missing or invalid platform ops API key',
  type: ErrorResponseDto,
})
export class PlatformGdprController {
  constructor(private readonly erasureService: ErasureService) {}

  @Post('erasure')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Subject erasure completed successfully')
  @ApiOperation({ summary: 'Anonymise a user or apprentice (platform ops)' })
  @ApiOkResponse({
    description: 'Erasure summary',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(ErasureResponseDto) },
      },
    },
  })
  erase(@Body() dto: ErasureRequestDto): Promise<ErasureResponseDto> {
    return this.erasureService.erase(dto);
  }
}
