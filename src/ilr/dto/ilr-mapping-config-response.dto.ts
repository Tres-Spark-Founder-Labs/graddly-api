import { ApiProperty } from '@nestjs/swagger';

import { IlrMappingConfigStatus } from '../enums/ilr-mapping-config-status.enum.js';

import type { IlrMappingConfigDocument } from '../types/ilr-mapping-config.types.js';

export class IlrMappingConfigResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '2025-26' })
  academicYear!: string;

  @ApiProperty({ example: 1 })
  version!: number;

  @ApiProperty({ enum: IlrMappingConfigStatus })
  status!: IlrMappingConfigStatus;

  @ApiProperty()
  config!: IlrMappingConfigDocument;

  @ApiProperty({ nullable: true })
  publishedAt!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}
