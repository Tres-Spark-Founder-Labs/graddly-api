import { Column, Entity, JoinColumn, ManyToOne, RelationId } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';
import { User } from '../../users/entities/user.entity.js';
import {
  DEFAULT_DIGEST_FREQUENCY,
  DigestFrequency,
} from '../enums/digest-frequency.enum.js';
import { NotificationChannel } from '../enums/notification-channel.enum.js';
import { NotificationType } from '../enums/notification-type.enum.js';

@Entity('notification_preferences')
export class NotificationPreference extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @RelationId((p: NotificationPreference) => p.user)
  userId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation | null;

  @RelationId((p: NotificationPreference) => p.organisation)
  organisationId!: string | null;

  @Column({
    type: 'enum',
    enum: NotificationChannel,
    enumName: 'notification_channel',
  })
  channel!: NotificationChannel;

  @Column({
    type: 'enum',
    enum: NotificationType,
    enumName: 'notification_type',
  })
  type!: NotificationType;

  @Column({ default: true })
  enabled!: boolean;

  /**
   * F1.2.3 AC7. Meaningful only when `channel` is DIGEST; other channels carry
   * the default and ignore it.
   */
  @Column({
    type: 'enum',
    enum: DigestFrequency,
    enumName: 'digest_frequency',
    default: DEFAULT_DIGEST_FREQUENCY,
  })
  frequency!: DigestFrequency;
}
