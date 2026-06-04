import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { PortalType } from '../portal-type.enum.js';

/** Minimal organisation shape embedded in auth responses (me, activeOrganisation). */
export class OrganisationSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Northstar Training Ltd' })
  name!: string;

  @ApiProperty({ example: 'northstar-training-ltd' })
  slug!: string;

  @ApiPropertyOptional({ example: 'provider', nullable: true })
  type!: string | null;

  @ApiPropertyOptional({ enum: PortalType, nullable: true })
  portalType!: PortalType | null;

  @ApiPropertyOptional({ example: '10012345', nullable: true })
  ukprn!: string | null;

  @ApiPropertyOptional({ example: '123 Training Lane', nullable: true })
  address!: string | null;

  @ApiPropertyOptional({ example: 'London', nullable: true })
  city!: string | null;

  @ApiPropertyOptional({ example: 'SW1A 1AA', nullable: true })
  postcode!: string | null;

  @ApiPropertyOptional({ example: 'United Kingdom', nullable: true })
  country!: string | null;

  @ApiPropertyOptional({
    example: 'info@northstar-training.co.uk',
    nullable: true,
  })
  orgEmail!: string | null;

  @ApiPropertyOptional({ example: '+44 20 7946 0958', nullable: true })
  orgPhone!: string | null;

  @ApiPropertyOptional({
    example: 'https://northstar-training.co.uk',
    nullable: true,
  })
  website!: string | null;

  @ApiPropertyOptional({
    example:
      'https://bucket.s3.eu-west-2.amazonaws.com/orgs/uuid/general/uuid/logo.png',
    nullable: true,
  })
  logoUrl!: string | null;
}

/** Full organisation resource returned by CRUD endpoints. */
export class OrganisationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Northstar Training Ltd' })
  name!: string;

  @ApiProperty({ example: 'northstar-training-ltd' })
  slug!: string;

  @ApiPropertyOptional({ example: 'provider', nullable: true })
  type!: string | null;

  @ApiPropertyOptional({ enum: PortalType, nullable: true })
  portalType!: PortalType | null;

  @ApiPropertyOptional({ example: '10012345', nullable: true })
  ukprn!: string | null;

  @ApiPropertyOptional({ example: '123 Training Lane', nullable: true })
  address!: string | null;

  @ApiPropertyOptional({ example: 'London', nullable: true })
  city!: string | null;

  @ApiPropertyOptional({ example: 'SW1A 1AA', nullable: true })
  postcode!: string | null;

  @ApiPropertyOptional({ example: 'United Kingdom', nullable: true })
  country!: string | null;

  @ApiPropertyOptional({
    example: 'info@northstar-training.co.uk',
    nullable: true,
  })
  orgEmail!: string | null;

  @ApiPropertyOptional({ example: '+44 20 7946 0958', nullable: true })
  orgPhone!: string | null;

  @ApiPropertyOptional({
    example: 'https://northstar-training.co.uk',
    nullable: true,
  })
  website!: string | null;

  @ApiPropertyOptional({
    example:
      'https://bucket.s3.eu-west-2.amazonaws.com/orgs/uuid/general/uuid/logo.png',
    nullable: true,
  })
  logoUrl!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
