import { ApiProperty } from '@nestjs/swagger';

import { CommitmentStatementStatus } from '../enums/commitment-statement-status.enum.js';

/**
 * F1.3.1 AC2 — "Signed (green) / Pending (amber) / Not sent (grey)".
 *
 * `CommitmentSignatureStatus` only has `pending` and `signed`, because a
 * signature row only exists once a statement has been published for
 * signatures. "Not sent" is therefore the *absence* of a row — a statement
 * still in draft — rather than a stored value, and is derived here so every
 * caller reads the same three states.
 */
export enum CommitmentPartyStatus {
  SIGNED = 'signed',
  PENDING = 'pending',
  NOT_SENT = 'not_sent',
}

export class CommitmentBoardRowDto {
  @ApiProperty({ format: 'uuid' })
  statementId!: string;

  @ApiProperty({ format: 'uuid' })
  enrolmentId!: string;

  @ApiProperty({ format: 'uuid' })
  apprenticeId!: string;

  /** F1.3.1 AC1 — column 1. */
  @ApiProperty({ nullable: true })
  apprenticeName!: string | null;

  /** AC1 — column 2. Null when the enrolment has no provider linked yet. */
  @ApiProperty({ nullable: true })
  providerName!: string | null;

  @ApiProperty({ nullable: true, format: 'uuid' })
  providerOrganisationId!: string | null;

  /** Not an AC1 column, but AC4 filters by it. */
  @ApiProperty({ nullable: true })
  standardName!: string | null;

  @ApiProperty({ nullable: true, format: 'uuid' })
  standardId!: string | null;

  /** AC1 — column 3. */
  @ApiProperty()
  version!: number;

  @ApiProperty({ enum: CommitmentStatementStatus })
  statementStatus!: CommitmentStatementStatus;

  /** AC1 — columns 4, 5 and 6. */
  @ApiProperty({ enum: CommitmentPartyStatus })
  employerStatus!: CommitmentPartyStatus;

  @ApiProperty({ enum: CommitmentPartyStatus })
  apprenticeStatus!: CommitmentPartyStatus;

  @ApiProperty({ enum: CommitmentPartyStatus })
  providerStatus!: CommitmentPartyStatus;

  /**
   * AC3 — "statements requiring employer signature are highlighted and sorted
   * to the top".
   *
   * True only when the employer can actually sign *now*: their own signature
   * is pending, and every party ahead of them in the signing order has
   * already signed. A statement where the employer is pending but the
   * provider has not signed yet is waiting on someone else, and putting it at
   * the top of the employer's board would be asking them to do something the
   * API would reject.
   */
  @ApiProperty()
  actionRequired!: boolean;

  @ApiProperty({ nullable: true, format: 'date-time' })
  publishedAt!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Set once every party has signed and the final PDF exists.',
  })
  finalSignedPdfKey!: string | null;
}

export class CommitmentBoardResponseDto {
  @ApiProperty({ type: [CommitmentBoardRowDto] })
  rows!: CommitmentBoardRowDto[];

  /**
   * F1.3.1 AC5 — "'Statements requiring action' count is shown as a badge on
   * the sidebar navigation item".
   *
   * Returned with the board rather than from a separate endpoint so the badge
   * and the list can never disagree, and counted across the whole result set
   * rather than the current filter — a badge that changed when you filtered
   * the table would be measuring the wrong thing.
   */
  @ApiProperty()
  actionRequiredCount!: number;

  @ApiProperty()
  total!: number;
}
