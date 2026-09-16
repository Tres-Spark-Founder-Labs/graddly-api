import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
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
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';

import { CreateSignatureRecordDto } from './dto/create-signature-record.dto.js';
import {
  SignSignatureRecordResponseDto,
  SignatureRecordResponseDto,
} from './dto/signature-record-response.dto.js';
import { EsignatureService } from './esignature.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import type { Request } from 'express';

@ApiTags('E-Signature')
@ApiExtraModels(SignatureRecordResponseDto, SignSignatureRecordResponseDto)
@Controller({ path: 'esignature', version: '1' })
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
export class EsignatureController {
  constructor(private readonly esignatureService: EsignatureService) {}

  @Post('records')
  @ResponseMessage('Signature record created successfully')
  @ApiOperation({ summary: 'Create a signature metadata record' })
  @ApiCreatedResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(SignatureRecordResponseDto) },
      },
    },
  })
  createRecord(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSignatureRecordDto,
    @Ip() clientIp: string,
    @Req() req: Request,
  ): Promise<SignatureRecordResponseDto> {
    setCurrentUserId(user.id);
    const userAgent = req.get('user-agent') ?? undefined;
    return this.esignatureService.createRecord(user, dto, clientIp, userAgent);
  }

  @Get('records/:id')
  @ResponseMessage('Signature record retrieved successfully')
  @ApiOperation({ summary: 'Get signature record by id' })
  @ApiOkResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(SignatureRecordResponseDto) },
      },
    },
  })
  getRecord(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SignatureRecordResponseDto> {
    setCurrentUserId(user.id);
    return this.esignatureService.findOne(user, id);
  }

  @Post('records/:id/sign')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Document signed successfully')
  @ApiOperation({ summary: 'Embed signature in PDF and store signed artefact' })
  @ApiOkResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(SignSignatureRecordResponseDto) },
      },
    },
  })
  signRecord(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SignSignatureRecordResponseDto> {
    setCurrentUserId(user.id);
    return this.esignatureService.completeSigning(user, id);
  }
}
