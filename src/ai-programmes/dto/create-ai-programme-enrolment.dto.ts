import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class CreateAiProgrammeEnrolmentDto {
  @ApiProperty({
    format: 'uuid',
    description: 'FlowPortal AI programme from the catalogue',
  })
  @IsUUID()
  programmeId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Existing apprentice on the Flow SME organisation',
  })
  @IsOptional()
  @IsUUID()
  apprenticeId?: string;

  @ApiPropertyOptional({ example: 'Alex' })
  @ValidateIf((dto: CreateAiProgrammeEnrolmentDto) => !dto.apprenticeId)
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Apprentice' })
  @ValidateIf((dto: CreateAiProgrammeEnrolmentDto) => !dto.apprenticeId)
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({ example: 'alex.apprentice@example.com' })
  @ValidateIf((dto: CreateAiProgrammeEnrolmentDto) => !dto.apprenticeId)
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-09-01' })
  @IsOptional()
  @IsDateString()
  plannedStartDate?: string;
}
