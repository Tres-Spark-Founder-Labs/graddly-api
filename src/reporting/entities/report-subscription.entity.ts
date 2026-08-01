import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { ReportSubscriptionType } from '../enums/report-subscription-type.enum.js';

/**
 * F1.4.1 AC5 — "scheduled monthly email delivery to configurable recipients".
 *
 * A distribution list, not a personal preference. That distinction is why this
 * is a separate table rather than another `notification_preferences` row: the
 * ROI report goes to whoever an employer admin nominates — a finance director,
 * an HR lead — and it is the *admin's* decision, not the recipient's. A
 * preference row would let a recipient silently opt out of a board report
 * somebody else is accountable for circulating.
 *
 * Recipients are `users`, not free-text addresses, deliberately. The report
 * carries apprentice-level figures, and decision 5 in `DECISIONS-FOR-CLIENT.md`
 * already settled the equivalent question for the OTJ digest: verified users
 * inside the organisation only, never unverified external addresses.
 */
@Entity('report_subscriptions')
@Index(
  'UQ_report_subscriptions_org_user_type',
  ['organisationId', 'userId', 'reportType'],
  { unique: true, where: `"isDeleted" = false` },
)
export class ReportSubscription extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({
    type: 'enum',
    enum: ReportSubscriptionType,
    enumName: 'report_subscription_type',
  })
  reportType!: ReportSubscriptionType;

  /**
   * Kept as a flag rather than deleting the row, so an admin can pause
   * delivery without losing who was on the list.
   */
  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ type: 'uuid', nullable: true })
  addedByUserId!: string | null;

  /** Set after each successful send, so a failed month is visible. */
  @Column({ type: 'timestamptz', nullable: true })
  lastSentAt!: Date | null;
}
