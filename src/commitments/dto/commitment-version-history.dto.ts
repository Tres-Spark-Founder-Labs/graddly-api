import { ApiProperty } from '@nestjs/swagger';

import { TripartiteParty } from '../../signing/tripartite-party.enum.js';
import { CommitmentStatementStatus } from '../enums/commitment-statement-status.enum.js';

/** One party's signature on a past or current version (F1.3.2 AC5). */
export class CommitmentVersionSignatoryDto {
  @ApiProperty({ enum: TripartiteParty })
  party!: TripartiteParty;

  @ApiProperty({ nullable: true, description: 'Resolved signatory name.' })
  name!: string | null;

  @ApiProperty()
  signed!: boolean;

  @ApiProperty({
    nullable: true,
    format: 'date-time',
    description: 'When they signed. Null while pending.',
  })
  signedAt!: string | null;
}

export class CommitmentVersionDto {
  @ApiProperty({ format: 'uuid' })
  statementId!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty({ enum: CommitmentStatementStatus })
  status!: CommitmentStatementStatus;

  @ApiProperty({ nullable: true, format: 'date-time' })
  publishedAt!: string | null;

  @ApiProperty({
    nullable: true,
    format: 'date-time',
    description: 'When this version was replaced by a later one.',
  })
  supersededAt!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Storage key for the fully signed PDF, once it exists.',
  })
  finalSignedPdfKey!: string | null;

  /** AC5 — "all prior versions with dates and signatories". */
  @ApiProperty({ type: [CommitmentVersionSignatoryDto] })
  signatories!: CommitmentVersionSignatoryDto[];
}

export class CommitmentVersionHistoryResponseDto {
  @ApiProperty({ format: 'uuid' })
  groupId!: string;

  @ApiProperty({
    type: [CommitmentVersionDto],
    description: 'Newest version first.',
  })
  versions!: CommitmentVersionDto[];
}

/** F1.3.2 AC6 — a short-lived link to the fully signed PDF. */
export class CommitmentSignedDocumentResponseDto {
  @ApiProperty({ format: 'uuid' })
  statementId!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty({ description: 'Presigned, short-lived.' })
  downloadUrl!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiProperty({ example: 'commitment-statement-v2.pdf' })
  filename!: string;
}
