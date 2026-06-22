import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { LevyEligibilityStatus } from '../enums/levy-eligibility-status.enum.js';

export class LevyEligibilityFundingBandDto {
  @ApiProperty({ example: 3000 })
  min!: number;

  @ApiProperty({ example: 27000 })
  max!: number;

  @ApiProperty({ example: 'GBP' })
  currency!: string;
}

export class LevyEligibilityResponseDto {
  @ApiProperty({
    enum: LevyEligibilityStatus,
    example: LevyEligibilityStatus.ELIGIBLE,
    description:
      'eligible — SME may proceed; not_eligible — outside SME bands; check_with_advisor — existing DAS account',
  })
  status!: LevyEligibilityStatus;

  @ApiProperty({ type: LevyEligibilityFundingBandDto })
  estimatedFundingBand!: LevyEligibilityFundingBandDto;

  @ApiProperty({
    type: [String],
    example: [
      'Begin ESFA employer registration to set up your Digital Apprenticeship Service account.',
    ],
  })
  nextSteps!: string[];

  @ApiPropertyOptional({
    example: '/api/v1/flowportal-registration/sessions',
    description: 'Registration wizard path when status is eligible',
  })
  beginRegistrationPath?: string;
}
