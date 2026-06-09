import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsObject, IsOptional, IsUUID } from 'class-validator';

export class CreateTransferFromMatchDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Confirmed match application UUID',
  })
  @IsUUID()
  matchApplicationId!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Recipient user UUID who will sign the transfer agreement',
  })
  @IsUUID()
  recipientSignerUserId!: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  programmeDetails?: Record<string, unknown>;
}
