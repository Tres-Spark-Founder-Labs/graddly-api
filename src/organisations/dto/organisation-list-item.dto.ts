import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { PortalType } from '../portal-type.enum.js';

/**
 * Lightweight organisation entry returned in the `organisations` list on auth
 * responses (`/me`). Carries only the fields a client needs to render an org
 * switcher: id, name, portalType and slug.
 */
export class OrganisationListItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Northstar Training Ltd' })
  name!: string;

  @ApiPropertyOptional({ enum: PortalType, nullable: true })
  portalType!: PortalType | null;

  @ApiProperty({ example: 'northstar-training-ltd' })
  slug!: string;
}
