import { ApiProperty } from '@nestjs/swagger';

export class MessageAttachmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    description:
      'S3 object key; use messaging download flow or storage download-url',
    example: 'orgs/uuid/learners/uuid/attachment/uuid/report.pdf',
  })
  storageKey!: string;

  @ApiProperty({ example: 'report.pdf' })
  filename!: string;

  @ApiProperty({ example: 'application/pdf' })
  contentType!: string;

  @ApiProperty({ example: 1048576 })
  contentLength!: number;
}
