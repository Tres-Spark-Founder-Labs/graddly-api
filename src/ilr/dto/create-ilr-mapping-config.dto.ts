import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsString, Matches, MaxLength } from 'class-validator';

import type { IlrMappingConfigDocument } from '../types/ilr-mapping-config.types.js';

export class CreateIlrMappingConfigDto {
  @ApiProperty({ example: '2025-26' })
  @IsString()
  @MaxLength(9)
  @Matches(/^\d{4}-\d{2}$/)
  academicYear!: string;

  @ApiProperty({ description: 'ILR mapping config document (fields + rules)' })
  @IsObject()
  config!: IlrMappingConfigDocument;
}
