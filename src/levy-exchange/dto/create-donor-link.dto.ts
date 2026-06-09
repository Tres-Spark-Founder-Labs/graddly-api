import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDonorLinkDto {
  @ApiProperty({
    required: false,
    description: 'Legal entity label for this DAS account link',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiProperty({
    required: false,
    description: 'UKPRN for the donor DAS account',
    maxLength: 8,
    example: '12345678',
  })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  ukprn?: string;
}
