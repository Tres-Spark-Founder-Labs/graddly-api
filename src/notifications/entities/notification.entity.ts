import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { NotificationType } from '../enums/notification-type.enum.js';

@Entity('notifications')
@Index(
  'IDX_notifications_user_read_created',
  ['userId', 'readAt', 'createdAt'],
  {
    where: `"isDeleted" = false`,
  },
)
@Index('IDX_notifications_user_org', ['userId', 'organisationId'], {
  where: `"isDeleted" = false`,
})
@Index('IDX_notifications_user_unread', ['userId'], {
  where: `"isDeleted" = false AND "readAt" IS NULL`,
})
export class Notification extends BaseEntity {
  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  /**
   * Required since migration 1781100000051 — `notifications_insert` is keyed on
   * it, so a NULL would make the row unwritable. Every one of the 18 call sites
   * already supplied it; the column was nullable only because nothing depended
   * on it.
   */
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  @Column({
    type: 'enum',
    enum: NotificationType,
    enumName: 'notification_type',
  })
  type!: NotificationType;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;
}
