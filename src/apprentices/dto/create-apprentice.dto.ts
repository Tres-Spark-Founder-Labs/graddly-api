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

  @ApiPropertyOptional({ enum: ApprenticeStatus })
  @IsOptional()
  @IsEnum(ApprenticeStatus)
  status?: ApprenticeStatus;
}
