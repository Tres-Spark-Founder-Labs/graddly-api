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

  @Column({ type: 'uuid', nullable: true })
  organisationId!: string | null;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation | null;

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
