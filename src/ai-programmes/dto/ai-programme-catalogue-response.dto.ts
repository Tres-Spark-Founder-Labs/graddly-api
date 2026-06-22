import { ApiProperty } from '@nestjs/swagger';

import { ProgrammeDeliveryType } from '../../programmes/enums/programme-delivery-type.enum.js';

export class AiProgrammeCatalogueEntryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({
    enum: ProgrammeDeliveryType,
    example: ProgrammeDeliveryType.FLOWPORTAL_AI,
  })
  deliveryType!: ProgrammeDeliveryType;

  @ApiProperty({
    description: 'Number of curriculum modules in this programme',
  })
  moduleCount!: number;
}

export class AiProgrammeModuleDto {
  @ApiProperty({ example: 'foundations' })
  slug!: string;

  @ApiProperty({ example: 'AI Foundations' })
  title!: string;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty({ nullable: true })
  description!: string | null;
}

export class AiProgrammeDetailDto extends AiProgrammeCatalogueEntryDto {
  @ApiProperty({ type: [AiProgrammeModuleDto] })
  modules!: AiProgrammeModuleDto[];
}
