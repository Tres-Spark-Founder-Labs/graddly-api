import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { EnrolmentStatus } from '../../enrolments/enums/enrolment-status.enum.js';
import {
  FundingClaimDiscrepancy,
  FundingClaimResolutionStatus,
} from '../enums/funding-claim-discrepancy.enum.js';

/**
 * F2.3.2 AC7 — "funding claim tracker shows: claimed amount, received amount,
 * any discrepancies, and resolution status".
 */
export class FundingClaimResponseDto {
  @ApiProperty({ format: 'uuid' })
  enrolmentId!: string;

  @ApiProperty()
  apprenticeName!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  standardTitle!: string | null;

  @ApiProperty({ enum: EnrolmentStatus })
  enrolmentStatus!: EnrolmentStatus;

  @ApiProperty({
    example: 15000,
    description: 'Agreed price on the enrolment, in pounds.',
  })
  claimedAmount!: number;

  @ApiProperty({
    example: 9000,
    description: 'Sum of DAS funding payments received for this enrolment.',
  })
  receivedAmount!: number;

  @ApiProperty({
    example: -6000,
    description:
      'Signed: received minus claimed. Negative is a shortfall, positive an ' +
      'overpayment. A caller reading an absolute value cannot tell which way ' +
      'the money went.',
  })
  varianceAmount!: number;

  @ApiProperty()
  paymentCount!: number;

  @ApiProperty({
    type: [String],
    description: 'Clawback notices from the ESFA against these payments.',
  })
  clawbackNotices!: string[];

  @ApiProperty({
    enum: FundingClaimDiscrepancy,
    description:
      'A shortfall only counts once the enrolment is completed. Funding ' +
      'arrives monthly, so an active learner having received less than the ' +
      'agreed price is the funding model working, not a discrepancy.',
  })
  discrepancy!: FundingClaimDiscrepancy;

  @ApiPropertyOptional({
    enum: FundingClaimResolutionStatus,
    nullable: true,
    description:
      'Null when there is nothing to resolve. Defaults to "open" for a ' +
      'discrepancy nobody has engaged with yet.',
  })
  resolutionStatus!: FundingClaimResolutionStatus | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  resolutionNote!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  resolvedAt!: string | null;
}
