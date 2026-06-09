import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumberString,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpsertRecipientProfileDto {
  @ApiProperty({
    maxLength: 100,
    example: 'construction',
    description: 'Recipient sector slug used for rule-based matching',
  })
  @IsString()
  @MaxLength(100)
  sector!: string;

  @ApiProperty({
    maxLength: 100,
    example: 'north_west',
    description: 'Recipient region slug used for rule-based matching',
  })
  @IsString()
  @MaxLength(100)
  region!: string;

  @ApiProperty({
    maxLength: 50,
    example: '10_49',
    description: 'Employee count band slug (e.g. 10_49, 50_249)',
  })
  @IsString()
  @MaxLength(50)
  employeeCountBand!: string;

  @ApiProperty({
    maxLength: 100,
    example: 'standards',
    description: 'Apprenticeship programme type slug',
  })
  @IsString()
  @MaxLength(100)
  programmeType!: string;

  @ApiProperty({
    example: '15000.00',
    description: 'Decimal amount of levy transfer required (GBP)',
  })
  @IsNumberString()
  transferAmountRequired!: string;

  @ApiProperty({
    default: false,
    description: 'Whether the recipient organisation already has a DAS account',
  })
  @IsBoolean()
  hasDasAccount!: boolean;
}
