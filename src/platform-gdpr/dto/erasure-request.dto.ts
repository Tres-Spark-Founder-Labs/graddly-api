import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export enum ErasureSubjectType {
  USER = 'user',
  APPRENTICE = 'apprentice',
}

export class ErasureRequestDto {
  @ApiProperty({ enum: ErasureSubjectType, example: ErasureSubjectType.USER })
  @IsEnum(ErasureSubjectType)
  subjectType!: ErasureSubjectType;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  subjectId!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
