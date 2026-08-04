import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { FundingClaimResolutionStatus } from '../enums/funding-claim-discrepancy.enum.js';

export class UpdateFundingClaimResolutionDto {
  @ApiProperty({ enum: FundingClaimResolutionStatus })
  @IsEnum(FundingClaimResolutionStatus)
  status!: FundingClaimResolutionStatus;

  /**
   * Optional on the DTO, required by the service when closing a claim.
   *
   * Enforced there rather than here because the requirement is conditional:
   * moving to "investigating" needs no justification, closing a four-thousand
   * pound gap does. class-validator cannot express that without a custom
   * validator, and the error message from the service is clearer than one.
   */
  @ApiPropertyOptional({
    description:
      'Required when resolving or writing off — an ESFA reconciliation asks ' +
      'why a gap was closed, and "someone clicked resolved" is not an answer.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
