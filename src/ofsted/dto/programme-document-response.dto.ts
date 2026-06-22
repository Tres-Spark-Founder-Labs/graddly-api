import { ApiProperty } from '@nestjs/swagger';

import { ProgrammeDocumentType } from '../enums/programme-document-type.enum.js';

export class ProgrammeDocumentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  programmeId!: string;

  @ApiProperty({ enum: ProgrammeDocumentType })
  documentType!: ProgrammeDocumentType;

  @ApiProperty({
    example: 'orgs/uuid/programmes/uuid/docs/curriculum-map.pdf',
  })
  storageKey!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  uploadedAt!: string;
}
