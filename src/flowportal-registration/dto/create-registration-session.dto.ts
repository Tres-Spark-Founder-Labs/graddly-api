import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateRegistrationSessionDto {
  @ApiPropertyOptional({
    example: 'employer@example.com',
    description: 'Contact email for confirmation (optional at start)',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  contactEmail?: string;

  @ApiPropertyOptional({
    example: 'construction',
    description: 'Sector slug pre-seeded from eligibility checker',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sector?: string;

  @ApiPropertyOptional({
    example: 'north_west',
    description: 'Region slug pre-seeded from eligibility checker',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;
}
