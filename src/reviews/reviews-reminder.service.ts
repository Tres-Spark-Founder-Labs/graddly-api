import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';

import {
  runWithTenantContext,
  withRlsBootstrap,
} from '../common/context/correlation-id-context.js';
import { EmailTemplate } from '../email/email-template.enum.js';
import { SerializedEmailPayload } from '../email/payloads/serialized-email.payload.js';
import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { User } from '../users/entities/user.entity.js';

import { ReviewReminderDispatch } from './entities/review-reminder-dispatch.entity.js';
import { Review } from './entities/review.entity.js';
import { ReviewReminderKind } from './enums/review-reminder-kind.enum.js';
import { ReviewStatus } from './enums/review-status.enum.js';

@Injectable()
export class ReviewsReminderService {
  private readonly logger = new Logger(ReviewsReminderService.name);

  constructor(
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
    @InjectRepository(ReviewReminderDispatch)
    private readonly dispatchRepo: Repository<ReviewReminderDispatch>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly notificationsService: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * F2.2.3 AC3 — the 7-day, 1-day and 48-hour reminders.
   *
   * `now` is injectable for the same reason the digest's is: the two
   * day-based reminders only go out on the 07:00 UTC run, so with the clock
   * read inside this method they could not be driven at all — a test either
   * ran at 07:00 or exercised the 48-hour path alone, which is what happened
   * (the job probe of 23 September could only reach one of the three). An
   * hour gate that makes two paths untestable is a design fault, not a
   * testing inconvenience.
   *
   * Production passes nothing and gets the real clock.
   */
  async sendDueReminders(now: Date = new Date()): Promise<number> {
    let sent = 0;
    const utcHour = now.getUTCHours();

    if (utcHour === 7) {
      sent += await this.sendForKind(ReviewReminderKind.SEVEN_DAYS, 7, now);
      sent += await this.sendForKind(ReviewReminderKind.ONE_DAY, 1, now);
    }

    sent += await this.sendForHourOffset(
      ReviewReminderKind.FORTY_EIGHT_HOURS,
      48,
      1,
      now,
    );

    return sent;
  }

  private async sendForKind(
    kind: ReviewReminderKind,
    daysAhead: number,
    now: Date,
  ): Promise<number> {
    const targetDay = this.utcDateOnly(now);
    targetDay.setUTCDate(targetDay.getUTCDate() + daysAhead);
    const dayStart = new Date(targetDay);
    const dayEnd = new Date(targetDay);
    dayEnd.setUTCHours(23, 59, 59, 999);

    /**
     * Security hardening pass, item 7 — cron sweep needs bootstrap.
     *
     * `reviews_select` is keyed on the owning or linked organisation. A cron
     * has none, so this returned zero reviews and **no reminder was ever sent**
     * — while `sendDueReminders` returned a tidy count of 0.
     *
     * Worth noting how this hid: `review-reminders.e2e-spec.ts` passes today.
     * It passes because an e2e process inherits the ambient tenant context
     * left behind by the HTTP requests that built its fixture, which a real
     * cron never has. A green test proving nothing is exactly what the
     * commitment-chase entry in this log warned about.
     */
    const reviews: Review[] = await withRlsBootstrap(() =>
      this.reviewRepo.find({
        where: {
          status: ReviewStatus.SCHEDULED,
          isDeleted: false,
          scheduledAt: Between(dayStart, dayEnd),
        },
      }),
    );

    return this.dispatchForReviews(reviews, kind, { daysAhead });
  }

  private async sendForHourOffset(
    kind: ReviewReminderKind,
    hoursAhead: number,
    toleranceHours: number,
    asOf: Date,
  ): Promise<number> {
    const now = asOf.getTime();
    const windowStart = new Date(
      now + (hoursAhead - toleranceHours) * 60 * 60 * 1000,
    );
    const windowEnd = new Date(
      now + (hoursAhead + toleranceHours) * 60 * 60 * 1000,
    );

    // Same bootstrap requirement as `sendForKind` above — this is the 48-hour
    // apprentice reminder and reads the same tenant-scoped table.
    const reviews: Review[] = await withRlsBootstrap(() =>
      this.reviewRepo.find({
        where: {
          status: ReviewStatus.SCHEDULED,
          isDeleted: false,
          scheduledAt: Between(windowStart, windowEnd),
        },
      }),
    );

    return this.dispatchForReviews(reviews, kind, { hoursAhead });
  }

  private async dispatchForReviews(
    reviews: Review[],
    kind: ReviewReminderKind,
    timing: { daysAhead?: number; hoursAhead?: number },
  ): Promise<number> {
    let sent = 0;
    for (const review of reviews) {
      sent += await runWithTenantContext(
        {
          label: `review-reminders:${review.id}`,
          organisationId: review.organisationId,
        },
        () => this.dispatchForReview(review, kind, timing),
      );
    }

    return sent;
  }

  /**
   * One review's reminder, in that review's own organisation.
   *
   * The reviews above are found under the bootstrap window — the sweep has no
   * organisation — but the guard and the dispatch row are tenant rows since
   * migration 1781100000062, so they run in the review's context, scoped by
   * `app.current_org` like any request. The recipient reads inside
   * `notifySigners` / `notifyApprenticeOnly` keep their own windows: a
   * signer may belong to another organisation.
   */
  private async dispatchForReview(
    review: Review,
    kind: ReviewReminderKind,
    timing: { daysAhead?: number; hoursAhead?: number },
  ): Promise<number> {
    /**
     * The "already reminded?" guard, scoped by this review's organisation.
     *
     * It reads what it will write: before 1781100000062 the table had no
     * organisation and no policy, so this lookup was the one read in the
     * sweep that no tenant applied to. Read with no organisation it matches
     * nothing and the guard stops guarding (a duplicate reminder every
     * run); scoped to the wrong organisation it matches nothing it should
     * and the row it writes suppresses that reminder permanently. Both
     * directions are proved in test/review-reminders.e2e-spec.ts.
     */
    const existing: ReviewReminderDispatch | null =
      await this.dispatchRepo.findOne({
        where: {
          organisationId: review.organisationId,
          reviewId: review.id,
          reminderKind: kind,
        },
      });
    if (existing) {
      return 0;
    }

    try {
      /**
       * Security hardening pass, item 7 — write the dispatch row only once
       * delivery is confirmed.
       *
       * Both notify paths could reach nobody and return normally:
       * `notifyApprenticeOnly` returns early when the apprentice user record
       * is missing, and `notifySigners` skips any signer it cannot resolve.
       * The dispatch row was written regardless, and it is the `existing`
       * guard above — so a review whose reminder silently failed could
       * **never be reminded again**.
       *
       * The same shape as otj-pace's weekly recurrence and the levy expiry
       * alert. Left un-stamped, the review stays eligible for the next run.
       */
      const delivered =
        kind === ReviewReminderKind.FORTY_EIGHT_HOURS
          ? await this.notifyApprenticeOnly(
              review,
              kind,
              timing.hoursAhead ?? 48,
            )
          : await this.notifySigners(review, kind, timing.daysAhead ?? 0);

      if (!delivered) {
        this.logger.warn(
          `Review reminder ${kind} reached nobody for review ${review.id}; leaving it eligible for the next run`,
        );
        return 0;
      }

      await this.dispatchRepo.save(
        this.dispatchRepo.create({
          organisationId: review.organisationId,
          reviewId: review.id,
          reminderKind: kind,
          sentAt: new Date(),
        }),
      );
      return 1;
    } catch (error) {
      this.logger.warn(
        `Failed review reminder ${kind} for ${review.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }

  private async notifySigners(
    review: Review,
    kind: ReviewReminderKind,
    daysAhead: number,
  ): Promise<boolean> {
    const userIds = [
      review.tutorUserId,
      review.apprenticeUserId,
      review.employerManagerUserId,
    ];
    // System read to discover who to notify — `users_select` needs a current
    // user or organisation, and a cron has neither.
    const users: User[] = await withRlsBootstrap(() =>
      this.userRepo.find({ where: { id: In(userIds) } }),
    );
    let delivered = 0;
    const scheduledLabel = review.scheduledAt.toISOString().slice(0, 10);
    const title = review.title ?? `Review on ${scheduledLabel}`;

    for (const signerId of userIds) {
      const signer = users.find((u) => u.id === signerId);
      if (!signer) {
        continue;
      }

      /**
       * `createForUser` returns null when the recipient holds no membership
       * of the organisation yet — the normal state between invitation and
       * account creation (F1.2.5 AC3/AC5), not a failure. This loop used to
       * count that null as a delivery, and the caller writes the dispatch
       * row on the strength of the count. The dispatch row is the
       * already-sent guard, so an invited-but-not-yet-joined apprentice had
       * their reminder recorded as sent and then suppressed for good.
       *
       * Reached means one channel landed: the in-app row, or an email
       * accepted by the send-time preference check (`suppressed` counts —
       * it is the recipient's own choice, and they were reached in-app or
       * would have been).
       */
      const notification = await this.notificationsService.createForUser({
        userId: signer.id,
        organisationId: review.organisationId,
        type: NotificationType.REVIEW,
        title: `Review reminder (${kind})`,
        body: `${title} is scheduled in ${daysAhead} day(s).`,
        metadata: { reviewId: review.id, reminderKind: kind },
      });
      let reached = notification !== null;

      if (signer.email) {
        await this.notificationsService.sendEmail({
          userId: signer.id,
          type: NotificationType.REVIEW,
          payload: new SerializedEmailPayload(
            EmailTemplate.REVIEW_REMINDER,
            signer.email,
            {
              firstName: signer.firstName,
              reviewTitle: title,
              scheduledAt: scheduledLabel,
              daysAhead,
              hoursAhead: null,
              appName: this.config.get<string>('app.email.appName', 'Graddly'),
            },
          ),
        });
        reached = true;
      }

      if (reached) {
        delivered += 1;
      }
    }

    return delivered > 0;
  }

  private async notifyApprenticeOnly(
    review: Review,
    kind: ReviewReminderKind,
    hoursAhead: number,
  ): Promise<boolean> {
    const apprentice: User | null = await withRlsBootstrap(() =>
      this.userRepo.findOne({
        where: { id: review.apprenticeUserId, isDeleted: false },
      }),
    );
    if (!apprentice) {
      // Reaching nobody is reported, not swallowed — the caller must not
      // record this reminder as sent.
      return false;
    }

    const scheduledLabel = review.scheduledAt.toISOString();
    const title = review.title ?? `Review on ${scheduledLabel.slice(0, 10)}`;

    // Null when the apprentice is not yet a member of the organisation: the
    // pre-membership state, which this used to report as reached. See
    // `notifySigners` above for what that cost.
    const notification = await this.notificationsService.createForUser({
      userId: apprentice.id,
      organisationId: review.organisationId,
      type: NotificationType.REVIEW,
      title: `Review reminder (${kind})`,
      body: `${title} is scheduled in ${hoursAhead} hour(s).`,
      metadata: { reviewId: review.id, reminderKind: kind },
    });

    if (apprentice.email) {
      await this.notificationsService.sendEmail({
        userId: apprentice.id,
        type: NotificationType.REVIEW,
        payload: new SerializedEmailPayload(
          EmailTemplate.REVIEW_REMINDER,
          apprentice.email,
          {
            firstName: apprentice.firstName,
            reviewTitle: title,
            scheduledAt: scheduledLabel.slice(0, 10),
            daysAhead: null,
            hoursAhead,
            appName: this.config.get<string>('app.email.appName', 'Graddly'),
          },
        ),
      });
      // The email is a delivery in its own right, whatever the in-app row did.
      return true;
    }

    // Reached the apprentice only if the in-app row landed; otherwise the
    // caller must leave the reminder eligible for the next sweep.
    return notification !== null;
  }

  private utcDateOnly(date: Date): Date {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }
}
