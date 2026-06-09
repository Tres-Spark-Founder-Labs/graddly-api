import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class UpdateEnrolmentOrganisationLinksDto {
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'Linked employer organisation for cross-portal reporting (employer portal org id)',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsOptional()
  @IsUUID()
  employerOrganisationId?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'Linked training provider organisation for cross-portal reporting',
    example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  })
  @IsOptional()
  @IsUUID()
  providerOrganisationId?: string | null;
}
