import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';

import {
  getRlsBootstrap,
  setRlsBootstrap,
} from '../common/context/correlation-id-context.js';
import { EmailDispatchService } from '../email/email-dispatch.service.js';
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
    private readonly emailDispatchService: EmailDispatchService,
    private readonly config: ConfigService,
  ) {}

  async sendDueReminders(): Promise<number> {
    let sent = 0;
    const utcHour = new Date().getUTCHours();

    if (utcHour === 7) {
      sent += await this.sendForKind(ReviewReminderKind.SEVEN_DAYS, 7);
      sent += await this.sendForKind(ReviewReminderKind.ONE_DAY, 1);
    }

    sent += await this.sendForHourOffset(
      ReviewReminderKind.FORTY_EIGHT_HOURS,
      48,
      1,
    );

    return sent;
  }

  private async sendForKind(
    kind: ReviewReminderKind,
    daysAhead: number,
  ): Promise<number> {
    const targetDay = this.utcDateOnly(new Date());
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
    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    let reviews: Review[];
    try {
      reviews = await this.reviewRepo.find({
        where: {
          status: ReviewStatus.SCHEDULED,
          isDeleted: false,
          scheduledAt: Between(dayStart, dayEnd),
        },
      });
    } finally {
      setRlsBootstrap(previousBootstrap);
    }

    return this.dispatchForReviews(reviews, kind, { daysAhead });
  }

  private async sendForHourOffset(
    kind: ReviewReminderKind,
    hoursAhead: number,
    toleranceHours: number,
  ): Promise<number> {
    const now = Date.now();
    const windowStart = new Date(
      now + (hoursAhead - toleranceHours) * 60 * 60 * 1000,
    );
    const windowEnd = new Date(
      now + (hoursAhead + toleranceHours) * 60 * 60 * 1000,
    );

    // Same bootstrap requirement as `sendForKind` above — this is the 48-hour
    // apprentice reminder and reads the same tenant-scoped table.
    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    let reviews: Review[];
    try {
      reviews = await this.reviewRepo.find({
        where: {
          status: ReviewStatus.SCHEDULED,
          isDeleted: false,
          scheduledAt: Between(windowStart, windowEnd),
        },
      });
    } finally {
      setRlsBootstrap(previousBootstrap);
    }

    return this.dispatchForReviews(reviews, kind, { hoursAhead });
  }

  private async dispatchForReviews(
    reviews: Review[],
    kind: ReviewReminderKind,
    timing: { daysAhead?: number; hoursAhead?: number },
  ): Promise<number> {
    let sent = 0;
    for (const review of reviews) {
      /**
       * Security hardening pass, item 7 — the "already reminded?" guard is
       * itself a tenant-scoped read.
       *
       * With no organisation context this returned null for every review, so
       * the guard silently stopped guarding. Bootstrapped alongside the
       * delivery below, because a duplicate reminder and a missing one are
       * both failures of the same lookup.
       */
      const previousBootstrap = getRlsBootstrap();
      setRlsBootstrap(true);
      let existing: ReviewReminderDispatch | null;
      try {
        existing = await this.dispatchRepo.findOne({
          where: { reviewId: review.id, reminderKind: kind },
        });
      } finally {
        setRlsBootstrap(previousBootstrap);
      }
      if (existing) {
        continue;
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
          continue;
        }

        await this.dispatchRepo.save(
          this.dispatchRepo.create({
            reviewId: review.id,
            reminderKind: kind,
            sentAt: new Date(),
          }),
        );
        sent++;
      } catch (error) {
        this.logger.warn(
          `Failed review reminder ${kind} for ${review.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return sent;
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
    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    let users: User[];
    try {
      users = await this.userRepo.find({ where: { id: In(userIds) } });
    } finally {
      setRlsBootstrap(previousBootstrap);
    }
    let delivered = 0;
    const scheduledLabel = review.scheduledAt.toISOString().slice(0, 10);
    const title = review.title ?? `Review on ${scheduledLabel}`;

    for (const signerId of userIds) {
      const signer = users.find((u) => u.id === signerId);
      if (!signer) {
        continue;
      }

      await this.notificationsService.createForUser({
        userId: signer.id,
        organisationId: review.organisationId,
        type: NotificationType.REVIEW,
        title: `Review reminder (${kind})`,
        body: `${title} is scheduled in ${daysAhead} day(s).`,
        metadata: { reviewId: review.id, reminderKind: kind },
      });
      delivered += 1;

      if (signer.email) {
        await this.emailDispatchService.enqueue(
          new SerializedEmailPayload(
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
        );
      }
    }

    return delivered > 0;
  }

  private async notifyApprenticeOnly(
    review: Review,
    kind: ReviewReminderKind,
    hoursAhead: number,
  ): Promise<boolean> {
    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    let apprentice: User | null;
    try {
      apprentice = await this.userRepo.findOne({
        where: { id: review.apprenticeUserId, isDeleted: false },
      });
    } finally {
      setRlsBootstrap(previousBootstrap);
    }
    if (!apprentice) {
      // Reaching nobody is reported, not swallowed — the caller must not
      // record this reminder as sent.
      return false;
    }

    const scheduledLabel = review.scheduledAt.toISOString();
    const title = review.title ?? `Review on ${scheduledLabel.slice(0, 10)}`;

    await this.notificationsService.createForUser({
      userId: apprentice.id,
      organisationId: review.organisationId,
      type: NotificationType.REVIEW,
      title: `Review reminder (${kind})`,
      body: `${title} is scheduled in ${hoursAhead} hour(s).`,
      metadata: { reviewId: review.id, reminderKind: kind },
    });

    if (apprentice.email) {
      await this.emailDispatchService.enqueue(
        new SerializedEmailPayload(
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
      );
    }

    // Reached the apprentice: the caller may record the reminder as sent.
    return true;
  }

  private utcDateOnly(date: Date): Date {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }
}
