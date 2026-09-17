import { ApiProperty } from '@nestjs/swagger';

import { LevyMatchApplicationStatus } from '../enums/levy-match-application-status.enum.js';

export class MatchApplicationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  donorOrganisationId!: string;

  /**
   * The donor as the match search presented it to the SME (F4.2.3 AC3): its
   * name, or "Matched donor" when it chose anonymous matching.
   *
   * An application is still the matching stage — no transfer, so no signed
   * agreement naming the parties yet — and the same rule applies whatever its
   * status. Once the donor creates a transfer, `LevyTransferResponseDto`
   * carries the name. Null when the donor has no active transfer preferences
   * (so whether it wanted anonymity cannot be known, and the name is not
   * disclosed) or its organisation no longer exists.
   */
  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'The donor’s name, or "Matched donor" when it matches anonymously ' +
      '(F4.2.3 AC3). Null when the API cannot say which applies.',
  })
  donorDisplayName!: string | null;

  @ApiProperty({ format: 'uuid' })
  recipientOrganisationId!: string;

  @ApiProperty({ example: '15000.00' })
  requestedAmount!: string;

  @ApiProperty({ enum: LevyMatchApplicationStatus })
  status!: LevyMatchApplicationStatus;

  @ApiProperty({ nullable: true, example: '85.50' })
  matchScore!: string | null;

  @ApiProperty({ nullable: true })
  scoreBreakdown!: Record<string, unknown> | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}
