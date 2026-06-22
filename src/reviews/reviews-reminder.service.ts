import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';

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

    const reviews = await this.reviewRepo.find({
      where: {
        status: ReviewStatus.SCHEDULED,
        isDeleted: false,
        scheduledAt: Between(dayStart, dayEnd),
      },
    });

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

    const reviews = await this.reviewRepo.find({
      where: {
        status: ReviewStatus.SCHEDULED,
        isDeleted: false,
        scheduledAt: Between(windowStart, windowEnd),
      },
    });

    return this.dispatchForReviews(reviews, kind, { hoursAhead });
  }

  private async dispatchForReviews(
    reviews: Review[],
    kind: ReviewReminderKind,
    timing: { daysAhead?: number; hoursAhead?: number },
  ): Promise<number> {
    let sent = 0;
    for (const review of reviews) {
      const existing = await this.dispatchRepo.findOne({
        where: { reviewId: review.id, reminderKind: kind },
      });
      if (existing) {
        continue;
      }

      try {
        if (kind === ReviewReminderKind.FORTY_EIGHT_HOURS) {
          await this.notifyApprenticeOnly(
            review,
            kind,
            timing.hoursAhead ?? 48,
          );
        } else {
          await this.notifySigners(review, kind, timing.daysAhead ?? 0);
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
  ): Promise<void> {
    const userIds = [
      review.tutorUserId,
      review.apprenticeUserId,
      review.employerManagerUserId,
    ];
    const users = await this.userRepo.find({ where: { id: In(userIds) } });
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
  }

  private async notifyApprenticeOnly(
    review: Review,
    kind: ReviewReminderKind,
    hoursAhead: number,
  ): Promise<void> {
    const apprentice = await this.userRepo.findOne({
      where: { id: review.apprenticeUserId, isDeleted: false },
    });
    if (!apprentice) {
      return;
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
  }

  private utcDateOnly(date: Date): Date {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }
}
