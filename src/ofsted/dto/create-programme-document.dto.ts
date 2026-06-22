import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, MaxLength } from 'class-validator';

import { ProgrammeDocumentType } from '../enums/programme-document-type.enum.js';

export class CreateProgrammeDocumentDto {
  @ApiProperty({
    enum: ProgrammeDocumentType,
    example: ProgrammeDocumentType.CURRICULUM_MAP,
    description: 'Required EIF document type for curriculum intent scoring',
  })
  @IsEnum(ProgrammeDocumentType)
  documentType!: ProgrammeDocumentType;

  @ApiProperty({
    description: 'S3 storage key for the uploaded document',
    example: 'orgs/uuid/programmes/uuid/docs/curriculum-map.pdf',
    maxLength: 512,
  })
  @IsString()
  @MaxLength(512)
  storageKey!: string;
}
