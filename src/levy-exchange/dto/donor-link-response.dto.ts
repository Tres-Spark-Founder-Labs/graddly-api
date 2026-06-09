import { ApiProperty } from '@nestjs/swagger';

import { DasDonorLinkStatus } from '../enums/das-donor-link-status.enum.js';

export class DonorLinkResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organisationId!: string;

  @ApiProperty({ nullable: true })
  label!: string | null;

  @ApiProperty({ nullable: true })
  dasAccountId!: string | null;

  @ApiProperty({ nullable: true })
  ukprn!: string | null;

  @ApiProperty({ enum: DasDonorLinkStatus })
  status!: DasDonorLinkStatus;

  @ApiProperty({ nullable: true })
  lastErrorMessage!: string | null;

  @ApiProperty({ nullable: true })
  consentedAt!: string | null;

  @ApiProperty({ nullable: true })
  lastSyncedAt!: string | null;

  @ApiProperty({ nullable: true, example: '12345.67' })
  lastBalance!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}
