import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Enrolment } from '../../enrolments/entities/enrolment.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';
import { FundingClaimResolutionStatus } from '../enums/funding-claim-discrepancy.enum.js';

/**
 * F2.3.2 AC7 — the "resolution status" half of the funding claim tracker.
 *
 * Claimed and received are both computed from data the platform already
 * holds: `enrolments.agreedPrice` against the sum of `das_funding_payments`.
 * Neither is stored here, because storing a copy of a number that is derived
 * from live data is how a tracker starts disagreeing with the payments it is
 * tracking.
 *
 * What cannot be derived is whether anyone has *done* anything about a
 * discrepancy. That is a fact about human action, and it is the only thing
 * this table holds.
 *
 * A row exists only once someone has engaged with a discrepancy. No row means
 * "open and untouched", which is the correct default for a claim nobody has
 * looked at yet — writing a row per enrolment up front would fill the table
 * with rows asserting that nothing has happened.
 */
@Entity('funding_claim_resolutions')
@Index('UQ_funding_claim_resolutions_enrolment', ['enrolmentId'], {
  unique: true,
  where: `"isDeleted" = false`,
})
@Index('IDX_funding_claim_resolutions_org_status', ['organisationId', 'status'])
export class FundingClaimResolution extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  @Column({ type: 'uuid' })
  enrolmentId!: string;

  @ManyToOne(() => Enrolment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'enrolmentId' })
  enrolment!: Enrolment;

  @Column({
    type: 'enum',
    enum: FundingClaimResolutionStatus,
    enumName: 'funding_claim_resolution_status',
    default: FundingClaimResolutionStatus.OPEN,
  })
  status!: FundingClaimResolutionStatus;

  /**
   * Required by the service when closing a claim, not by the column.
   *
   * "Resolved" with no explanation is unauditable: an ESFA reconciliation
   * conversation asks *why* a £4,000 gap was closed, and "someone clicked
   * resolved in 2026" is not an answer.
   */
  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'uuid', nullable: true })
  updatedByUserId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt!: Date | null;
}
