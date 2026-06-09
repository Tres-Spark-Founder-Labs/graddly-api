import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { LevyTransferStatus } from '../enums/levy-transfer-status.enum.js';

export class LevyTransferResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  donorOrganisationId!: string;

  @ApiProperty({ format: 'uuid' })
  recipientOrganisationId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  matchApplicationId!: string | null;

  @ApiProperty()
  amount!: string;

  @ApiPropertyOptional({ nullable: true })
  programmeDetails!: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true })
  esfaTransferReference!: string | null;

  @ApiProperty({ enum: LevyTransferStatus })
  status!: LevyTransferStatus;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  startDate!: string | null;

  @ApiPropertyOptional({ nullable: true })
  confirmedAt!: string | null;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  expiryDate!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}
