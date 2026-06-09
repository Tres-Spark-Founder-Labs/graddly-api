import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { LevyTransferParty } from '../enums/levy-transfer-party.enum.js';
import { LevyTransferStatus } from '../enums/levy-transfer-status.enum.js';

export class SignTransferResponseDto {
  @ApiProperty({ format: 'uuid' })
  transferId!: string;

  @ApiProperty({ enum: LevyTransferParty })
  party!: LevyTransferParty;

  @ApiProperty({ enum: LevyTransferStatus })
  status!: LevyTransferStatus;

  @ApiProperty()
  signedPdfKey!: string;

  @ApiPropertyOptional()
  downloadUrl?: string;

  @ApiPropertyOptional()
  downloadExpiresAt?: string;

  @ApiPropertyOptional({ enum: LevyTransferParty, nullable: true })
  nextParty!: LevyTransferParty | null;
}
