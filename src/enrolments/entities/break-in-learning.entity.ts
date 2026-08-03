import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { Apprentice } from '../../apprentices/entities/apprentice.entity.js';
import { BaseEntity } from '../../common/entities/base.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';
import { User } from '../../users/entities/user.entity.js';

import { Enrolment } from './enrolment.entity.js';

/**
 * F2.2.4 AC6 — a recorded break in learning.
 *
 * An event with a start and an end, not a property of the learner. The
 * profile previously reported `reason: null, expectedReturnDate: null`
 * because there was nowhere to put either, so a paused apprentice carried no
 * explanation and no return date.
 *
 * Kept as history: an apprenticeship can have several breaks, planned break
 * duration affects funding and the expected end date, and "did they return
 * when they said they would" is only answerable from the record of what was
 * said at the time.
 */
@Entity('break_in_learning')
@Index(['organisationId', 'enrolmentId'])
export class BreakInLearning extends BaseEntity {
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

  @Column({ type: 'uuid' })
  apprenticeId!: string;

  @ManyToOne(() => Apprentice, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'apprenticeId' })
  apprentice!: Apprentice;

  /** Required. A break with no stated reason is not a record of anything. */
  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'date' })
  startedOn!: string;

  /**
   * Nullable because it is genuinely unknown for some breaks — long-term
   * sickness, for instance. Forcing a date would produce a made-up one, which
   * is worse than an honest blank on a funding record.
   */
  @Column({ type: 'date', nullable: true })
  expectedReturnDate!: string | null;

  /** Set when the learner returns; `null` means the break is still open. */
  @Column({ type: 'date', nullable: true })
  actualReturnDate!: string | null;

  @Column({ type: 'uuid', nullable: true })
  recordedByUserId!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'recordedByUserId' })
  recordedBy!: User | null;

  @Column({ type: 'uuid', nullable: true })
  endedByUserId!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'endedByUserId' })
  endedBy!: User | null;

  /**
   * When the ILR push was *queued*, not when the ESFA accepted it — delivery
   * has its own status on the push record. This answers "was DAS told about
   * this break" without a join.
   */
  @Column({ type: 'timestamptz', nullable: true })
  dasNotifiedAt!: Date | null;
}
