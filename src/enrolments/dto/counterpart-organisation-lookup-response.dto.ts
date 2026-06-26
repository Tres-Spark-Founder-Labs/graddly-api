import { ApiProperty } from '@nestjs/swagger';

import { PortalType } from '../../organisations/portal-type.enum.js';

export class CounterpartOrganisationLookupResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Acme Engineering Ltd' })
  name!: string;

  @ApiProperty({ example: '10012345' })
  ukprn!: string;

  @ApiProperty({ enum: PortalType, example: PortalType.EMPLOYER })
  portalType!: PortalType;
}
