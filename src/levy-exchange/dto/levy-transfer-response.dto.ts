import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { LevyTransferParty } from '../enums/levy-transfer-party.enum.js';
import { LevyTransferStatus } from '../enums/levy-transfer-status.enum.js';

/** One party's signature slot, as either party to the transfer sees it. */
export class LevyTransferSignatureStateDto {
  @ApiProperty({ enum: LevyTransferParty })
  party!: LevyTransferParty;

  @ApiProperty({
    description:
      'Signing order. The donor signs first (1), then the recipient (2).',
  })
  signOrder!: number;

  @ApiProperty()
  signed!: boolean;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  signedAt!: string | null;
}

export class LevyTransferResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  donorOrganisationId!: string;

  /**
   * Who the transfer is from, for either party.
   *
   * Not an anonymity decision. Anonymity is a matching-stage display rule
   * (F4.2.3 AC3, "Matched donor" if anonymous), applied by the match search.
   * A transfer can only be created from a CONFIRMED match
   * (`LevyTransferService.createFromMatch`), and the agreement generated at
   * that moment already names the donor — F4.2.4 AC2's "signatory details",
   * printed as `donorOrganisationName` by the PDF processor and downloadable
   * by the recipient from draft onwards. This field is that same name.
   *
   * Null only when the donor's organisation row no longer exists.
   */
  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'The donor organisation’s name. The parties to a transfer are ' +
      'known to each other; null only when the organisation no longer exists.',
  })
  donorOrganisationName!: string | null;

  @ApiProperty({ format: 'uuid' })
  recipientOrganisationId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  matchApplicationId!: string | null;

  @ApiProperty()
  amount!: string;

  @ApiPropertyOptional({ nullable: true })
  programmeDetails!: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true })
  esfaTransferReference!: string | null;

  @ApiProperty({ enum: LevyTransferStatus })
  status!: LevyTransferStatus;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  startDate!: string | null;

  @ApiPropertyOptional({ nullable: true })
  confirmedAt!: string | null;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  expiryDate!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiProperty({
    type: [LevyTransferSignatureStateDto],
    description: 'Both parties\u2019 signature slots, in signing order.',
  })
  signatures!: LevyTransferSignatureStateDto[];

  @ApiPropertyOptional({
    enum: LevyTransferParty,
    nullable: true,
    description:
      'The party whose signature is awaited. Null unless status is ' +
      'pending_signatures: before the agreement PDF exists, and once both ' +
      'parties have signed.',
  })
  nextParty!: LevyTransferParty | null;

  /**
   * Whether the requesting user can sign this transfer right now.
   *
   * The equivalent of `CommitmentBoardRowDto.actionRequired`, and computed the
   * same way: the caller's party is unsigned AND every lower signOrder has
   * signed — it is next, not merely unsigned. `status === pending_signatures`
   * is not a substitute: it is true while the other party still has to sign.
   * It also applies the sign endpoint's own signer rule (the assigned signer,
   * or an owner or admin of the organisation), so `true` is never an
   * invitation the API would refuse.
   */
  @ApiProperty({
    description:
      'True when the requesting user can sign now: their party is next in ' +
      'order and they are its assigned signer or an organisation owner/admin.',
  })
  actionRequired!: boolean;
}
