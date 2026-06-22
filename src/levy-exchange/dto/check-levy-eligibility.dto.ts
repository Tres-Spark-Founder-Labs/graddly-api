import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsString, MaxLength } from 'class-validator';

export class CheckLevyEligibilityDto {
  @ApiProperty({
    maxLength: 50,
    example: '10_49',
    description:
      'Employee count band slug (1_9, 10_49, 50_249 for SME; 250_plus is levy-paying)',
  })
  @IsString()
  @MaxLength(50)
  employeeCountBand!: string;

  @ApiProperty({
    maxLength: 100,
    example: 'construction',
    description: 'Employer sector slug',
  })
  @IsString()
  @MaxLength(100)
  sector!: string;

  @ApiProperty({
    maxLength: 100,
    example: 'north_west',
    description: 'Employer region slug',
  })
  @IsString()
  @MaxLength(100)
  region!: string;

  @ApiProperty({
    example: false,
    description:
      'Whether the employer already has a Digital Apprenticeship Service account',
  })
  @IsBoolean()
  hasDasAccount!: boolean;
}
