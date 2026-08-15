import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Enrolment } from '../../enrolments/entities/enrolment.entity.js';

import { LevyTransfer } from './levy-transfer.entity.js';

/**
 * Which enrolments a levy transfer paid for. F4.1.4 AC1 — "number of learners
 * enrolled" on the donor analytics dashboard.
 *
 * ── WHY THIS TABLE EXISTS ───────────────────────────────────────────────────
 *
 * A transfer records an amount, a donor, a recipient and free-form
 * `programmeDetails` JSON. Nothing recorded which learners the money actually
 * funded, so a donor's learner count was not derivable from the data model at
 * all.
 *
 * The cheap alternative — counting every enrolment at each funded SME — was
 * rejected. It credits the donor with learners the SME funded by other means,
 * and this figure is designed to be published: F4.1.4 AC4 exports it for
 * "inclusion in annual ESG or social value reports". A number that goes in
 * front of a donor's stakeholders has to be one we can show the derivation of.
 *
 * ── WHY A JOIN TABLE AND NOT A COLUMN ON `enrolments` ───────────────────────
 *
 * `enrolments.fundedByTransferId` would have been simpler, and assumes one
 * transfer per enrolment. That assumption is not safe: an apprenticeship
 * running over three years can be part-funded by more than one transfer, and
 * the ESFA transfer rules do not forbid it. A join table costs one migration
 * now; unpicking a wrong cardinality later costs a data migration on funding
 * records.
 *
 * The unique index is on the *pair*, so the same transfer can fund many
 * enrolments and an enrolment can be funded by several transfers — but the
 * same pair cannot be recorded twice and double-count a learner.
 */
@Entity('levy_transfer_enrolments')
@Index('IDX_levy_transfer_enrolments_transfer', ['transferId'])
@Index('IDX_levy_transfer_enrolments_enrolment', ['enrolmentId'])
@Index('UQ_levy_transfer_enrolments_pair', ['transferId', 'enrolmentId'], {
  unique: true,
  where: `"isDeleted" = false`,
})
export class LevyTransferEnrolment extends BaseEntity {
  @Column({ type: 'uuid' })
  transferId!: string;

  @ManyToOne(() => LevyTransfer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'transferId' })
  transfer!: LevyTransfer;

  @Column({ type: 'uuid' })
  enrolmentId!: string;

  @ManyToOne(() => Enrolment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'enrolmentId' })
  enrolment!: Enrolment;

  /**
   * The donor, denormalised.
   *
   * Analytics reads this table by donor, and without it every query has to
   * join through `levy_transfers` to find out whose money it was. It is also
   * the column the row-level security policy keys on — a donor may only see
   * rows for their own transfers — and an RLS predicate that has to traverse a
   * join is both slower and easier to get wrong.
   */
  @Column({ type: 'uuid' })
  donorOrganisationId!: string;

  /**
   * The amount of this transfer attributed to this enrolment, if it was
   * apportioned. Null means "not apportioned" — the link records that the
   * transfer funded the enrolment without claiming how much.
   *
   * Deliberately nullable rather than defaulting to an even split: an invented
   * apportionment would flow straight into a published funding figure.
   */
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  attributedAmount!: string | null;
}
