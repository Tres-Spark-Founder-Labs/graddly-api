import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { withRlsBootstrap } from '../common/context/correlation-id-context.js';

import { PushSubscription } from './entities/push-subscription.entity.js';
import { WebPushClient } from './web-push.client.js';

/** What the service worker shows. `url` is where a tap goes (F3.1.4 AC5). */
export interface IPushPayload {
  title: string;
  body: string;
  url: string;
  /** Collapses repeats of the same alert on the device. */
  tag?: string;
}

export interface IPushDeliveryOutcome {
  /** Subscriptions the push service accepted. */
  delivered: number;
  /** Subscriptions that answered 404/410 and were deleted. */
  expired: number;
  /** Subscriptions that failed for any other reason; kept for next time. */
  failed: number;
}

/**
 * F3.4.3 AC4 — web push to every browser a user opted in on.
 *
 * Subscriptions are the user's: the store is per user, and the routes that
 * write them run as that user under `push_subscriptions_*`. The send path is
 * different — a cron, or another person's action, pushes to a recipient who
 * is not the actor, and the recipient's rows are invisible to anyone else
 * under row-level security. So `sendToUser` reads them under the rule on
 * `withRlsBootstrap`: the three columns a send needs, for one user whose id
 * the caller took from a record it had already read, in a window holding
 * that read (and the delete of a dead row) and nothing else.
 *
 * Whether the recipient wants this type pushed is not decided here; it is
 * `NotificationsService.sendPush`, which calls this after the per-type check.
 */
@Injectable()
export class PushNotificationsService {
  private readonly logger = new Logger(PushNotificationsService.name);

  constructor(
    @InjectRepository(PushSubscription)
    private readonly subscriptionRepo: Repository<PushSubscription>,
    private readonly client: WebPushClient,
  ) {}

  isEnabled(): boolean {
    return this.client.isEnabled();
  }

  publicKey(): string | null {
    return this.client.publicKey();
  }

  /**
   * Stores this browser's subscription for this user. Idempotent on the
   * endpoint: a browser that subscribes again (a reload after
   * `pushManager.subscribe()` returned the same subscription) updates its own
   * row rather than adding one. Runs as the user.
   */
  async subscribe(
    userId: string,
    input: {
      endpoint: string;
      p256dh: string;
      auth: string;
      userAgent: string | null;
    },
  ): Promise<PushSubscription> {
    const existing = await this.subscriptionRepo.findOne({
      where: { endpoint: input.endpoint, isDeleted: false },
    });
    if (existing) {
      if (existing.userId !== userId) {
        // The same browser, a different account signed in: the subscription
        // now belongs to whoever is using it. The old owner's row is retired
        // rather than silently re-pointed, so the audit trail keeps both.
        existing.isDeleted = true;
        existing.deletedAt = new Date();
        await this.subscriptionRepo.save(existing);
      } else {
        existing.p256dh = input.p256dh;
        existing.auth = input.auth;
        existing.userAgent = input.userAgent;
        return this.subscriptionRepo.save(existing);
      }
    }
    return this.subscriptionRepo.save(
      this.subscriptionRepo.create({
        user: { id: userId },
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent,
      }),
    );
  }

  /** Retires the user's subscription for this endpoint. Runs as the user. */
  async unsubscribe(userId: string, endpoint: string): Promise<number> {
    const rows = await this.subscriptionRepo.find({
      where: { user: { id: userId }, endpoint, isDeleted: false },
    });
    for (const row of rows) {
      row.isDeleted = true;
      row.deletedAt = new Date();
      await this.subscriptionRepo.save(row);
    }
    return rows.length;
  }

  /** Whether this user has any live subscription. Runs as the user. */
  async hasSubscription(userId: string): Promise<boolean> {
    return (
      (await this.subscriptionRepo.count({
        where: { user: { id: userId }, isDeleted: false },
      })) > 0
    );
  }

  /**
   * Pushes to every live subscription of a recipient. A 404 or 410 from the
   * push service means the browser unsubscribed or the endpoint expired, and
   * the row is deleted so it is not tried again; any other failure is logged
   * and the row kept, since a push service can be briefly unavailable.
   */
  async sendToUser(
    userId: string,
    payload: IPushPayload,
  ): Promise<IPushDeliveryOutcome> {
    const outcome: IPushDeliveryOutcome = {
      delivered: 0,
      expired: 0,
      failed: 0,
    };
    if (!this.client.isEnabled()) {
      return outcome;
    }

    const subscriptions = await withRlsBootstrap(() =>
      this.subscriptionRepo.find({
        where: { user: { id: userId }, isDeleted: false },
        select: ['id', 'endpoint', 'p256dh', 'auth'],
      }),
    );

    const body = JSON.stringify(payload);
    for (const subscription of subscriptions) {
      try {
        await this.client.send(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          body,
        );
        outcome.delivered += 1;
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await withRlsBootstrap(() =>
            this.subscriptionRepo.update(subscription.id, {
              isDeleted: true,
              deletedAt: new Date(),
            }),
          );
          outcome.expired += 1;
          continue;
        }
        outcome.failed += 1;
        this.logger.warn(
          `Push to subscription ${subscription.id} failed${
            statusCode ? ` (${statusCode})` : ''
          }: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return outcome;
  }
}
