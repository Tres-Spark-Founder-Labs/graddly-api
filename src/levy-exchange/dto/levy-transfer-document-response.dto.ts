import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { LevyTransferDocumentStatus } from '../enums/levy-transfer-document-status.enum.js';

export class LevyTransferDocumentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  transferId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  pdfJobId!: string | null;

  @ApiProperty({ enum: LevyTransferDocumentStatus })
  status!: LevyTransferDocumentStatus;

  @ApiPropertyOptional()
  downloadUrl?: string;

  @ApiPropertyOptional()
  downloadExpiresAt?: string;
}
