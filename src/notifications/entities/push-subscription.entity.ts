import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  RelationId,
} from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { User } from '../../users/entities/user.entity.js';

/**
 * F3.4.3 AC4 — one browser's web-push subscription for one user.
 *
 * What `PushManager.subscribe()` returns, stored as the push service needs it
 * back: the endpoint URL and the two keys the payload is encrypted with. A
 * user has one row per browser they opted in on; a phone and a laptop are two
 * rows. The endpoint is the identity — a browser that re-subscribes gets a
 * new one, and a push service that answers 404 or 410 for an endpoint is
 * saying it is gone for good, at which point the row is deleted.
 *
 * Per user, like a notification preference, and readable only by that user
 * under row-level security; the send path reads it for a recipient who is not
 * the actor, under the same rule as `isEnabledForRecipient`.
 */
@Entity('push_subscriptions')
@Index('UQ_push_subscriptions_endpoint_active', ['endpoint'], {
  unique: true,
  where: '"isDeleted" = false',
})
export class PushSubscription extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @RelationId((s: PushSubscription) => s.user)
  userId!: string;

  /** The push service URL for this browser. Unique while the row is live. */
  @Column({ type: 'text' })
  endpoint!: string;

  /** The browser's P-256 ECDH public key, base64url, as the Push API gives it. */
  @Column({ type: 'text' })
  p256dh!: string;

  /** The browser's authentication secret, base64url. */
  @Column({ type: 'text' })
  auth!: string;

  /** The User-Agent that subscribed, so a person can tell their devices apart. */
  @Column({ type: 'varchar', length: 512, nullable: true })
  userAgent!: string | null;
}
