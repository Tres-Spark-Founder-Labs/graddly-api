import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { PortalType } from '../portal-type.enum.js';

export class CreateOrganisationDto {
  @ApiProperty({
    example: 'Northstar Training Ltd',
    minLength: 2,
    maxLength: 200,
  })
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @ApiProperty({
    example: '10012345',
    description: 'UK Provider Reference Number — exactly 8 digits',
  })
  @IsNotEmpty()
  @Matches(/^\d{8}$/, { message: 'UKPRN must be exactly 8 digits' })
  ukprn!: string;

  @ApiProperty({ example: '123 Training Lane', maxLength: 200 })
  @IsNotEmpty()
  @MaxLength(200)
  address!: string;

  @ApiProperty({ example: 'London', maxLength: 100 })
  @IsNotEmpty()
  @MaxLength(100)
  city!: string;

  @ApiProperty({ example: 'SW1A 1AA', maxLength: 10 })
  @IsNotEmpty()
  @MaxLength(10)
  @Transform(({ value }: { value: string }) => value.toUpperCase())
  postcode!: string;

  @ApiProperty({ example: 'United Kingdom' })
  @IsNotEmpty()
  country!: string;

  @ApiProperty({ example: 'info@northstar-training.co.uk' })
  @IsEmail()
  orgEmail!: string;

  @ApiPropertyOptional({ example: '+44 20 7946 0958', maxLength: 20 })
  @IsOptional()
  @MaxLength(20)
  orgPhone?: string;

  @ApiPropertyOptional({
    example: 'https://northstar-training.co.uk',
    maxLength: 500,
  })
  @IsOptional()
  @IsUrl({}, { message: 'Enter a valid URL (including https://)' })
  website?: string;

  @ApiPropertyOptional({
    example:
      'https://bucket.s3.eu-west-2.amazonaws.com/orgs/uuid/general/uuid/logo.png',
    maxLength: 500,
    description: 'Public URL of the organisation logo (e.g. an S3 object URL)',
  })
  @IsOptional()
  @IsUrl({}, { message: 'Enter a valid URL (including https://)' })
  @MaxLength(500)
  logoUrl?: string;

  @ApiPropertyOptional({ enum: PortalType, example: PortalType.PROVIDER })
  @IsOptional()
  @IsEnum(PortalType)
  portalType?: PortalType;
}
