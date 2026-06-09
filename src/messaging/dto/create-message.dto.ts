import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import {
  MAX_MESSAGE_ATTACHMENT_BYTES,
  MAX_MESSAGE_BODY_LENGTH,
} from '../messaging.constants.js';

export class MessageAttachmentInputDto {
  @ApiProperty({
    description: 'Storage key from POST /messaging/attachments/upload-url',
    example: 'orgs/uuid/learners/uuid/attachment/uuid/file.pdf',
  })
  @IsString()
  storageKey!: string;

  @ApiProperty({ example: 'file.pdf' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  filename!: string;

  @ApiProperty({ example: 'application/pdf' })
  @IsString()
  contentType!: string;

  @ApiProperty({ example: 524288 })
  @IsInt()
  @Min(1)
  @Max(MAX_MESSAGE_ATTACHMENT_BYTES)
  contentLength!: number;
}

export class CreateMessageDto {
  @ApiProperty({
    description: 'Plain text message body (emoji supported)',
    example: 'Could we schedule a catch-up this week?',
    minLength: 1,
    maxLength: MAX_MESSAGE_BODY_LENGTH,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_MESSAGE_BODY_LENGTH)
  body!: string;

  @ApiProperty({
    type: [MessageAttachmentInputDto],
    required: false,
    description: 'File attachments (max 10 MB each, up to 10 files)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => MessageAttachmentInputDto)
  attachments?: MessageAttachmentInputDto[];
}

export class CreateMessageAttachmentUploadUrlDto {
  @ApiProperty({ format: 'uuid', description: 'Apprentice record ID' })
  @IsUUID()
  apprenticeId!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Enrolment the attachment relates to',
  })
  @IsUUID()
  enrolmentId!: string;

  @ApiProperty({ example: 'evidence.pdf' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  filename!: string;

  @ApiProperty({ example: 'application/pdf' })
  @IsString()
  contentType!: string;

  @ApiProperty({
    example: 524288,
    description: 'File size in bytes (max 10 MB for messaging)',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_MESSAGE_ATTACHMENT_BYTES)
  contentLength!: number;
}
