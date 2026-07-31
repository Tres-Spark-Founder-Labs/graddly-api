import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { ApprenticeStatus } from '../enums/apprentice-status.enum.js';

export class CreateApprenticeDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
  lastName!: string;

  @ApiProperty()
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiPropertyOptional({
    maxLength: 64,
    example: 'EMP-04821',
    description:
      "The employer's own payroll or staff reference. Optional, and not " +
      'unique across organisations.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  employeeId?: string;

  @ApiPropertyOptional({
    maxLength: 120,
    example: 'Junior Software Engineer',
    description:
      'F1.2.5 AC1 — the role the apprenticeship supports. The employer’s ' +
      'description of the job, not the apprenticeship standard.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  jobTitle?: string;

  @ApiPropertyOptional({ enum: ApprenticeStatus })
  @IsOptional()
  @IsEnum(ApprenticeStatus)
  status?: ApprenticeStatus;
}
