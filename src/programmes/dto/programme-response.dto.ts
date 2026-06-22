import { ApiProperty } from '@nestjs/swagger';

import { ProgrammeDeliveryType } from '../enums/programme-delivery-type.enum.js';
import { ProgrammeStatus } from '../enums/programme-status.enum.js';

export class ProgrammeResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organisationId!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ enum: ProgrammeStatus })
  status!: ProgrammeStatus;

  @ApiProperty({
    enum: ProgrammeDeliveryType,
    default: ProgrammeDeliveryType.EMPLOYER_LED,
    required: false,
  })
  deliveryType?: ProgrammeDeliveryType;
}
