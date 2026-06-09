import { ApiProperty } from '@nestjs/swagger';

import { MessageAttachmentResponseDto } from './message-attachment-response.dto.js';

export class MessageResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  threadId!: string;

  @ApiProperty({ format: 'uuid' })
  senderUserId!: string;

  @ApiProperty({
    description: 'Plain text body; emoji supported',
    example: 'Hi tutor, I have a question about my OTJ log 👋',
  })
  body!: string;

  @ApiProperty({ type: [MessageAttachmentResponseDto] })
  attachments!: MessageAttachmentResponseDto[];

  @ApiProperty()
  createdAt!: string;
}
