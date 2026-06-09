import { ApiProperty } from '@nestjs/swagger';

export class DonorLinkConsentStartResponseDto {
  @ApiProperty({
    description: 'ESFA DAS OAuth authorization URL to redirect the donor user',
  })
  authorizeUrl!: string;
}
