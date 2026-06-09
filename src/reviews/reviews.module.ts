import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { EmailModule } from '../email/email.module.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OfstedModule } from '../ofsted/ofsted.module.js';
import { PdfGenerationJob } from '../pdf/entities/pdf-generation-job.entity.js';
import { PdfModule } from '../pdf/pdf.module.js';
import { SigningModule } from '../signing/signing.module.js';
import { User } from '../users/entities/user.entity.js';

import { ReviewRecord } from './entities/review-record.entity.js';
import { ReviewReminderDispatch } from './entities/review-reminder-dispatch.entity.js';
import { ReviewSignature } from './entities/review-signature.entity.js';
import { Review } from './entities/review.entity.js';
import { ReviewRecordsService } from './review-records.service.js';
import { ReviewsCoSignService } from './reviews-co-sign.service.js';
import { ReviewsOverdueService } from './reviews-overdue.service.js';
import { ReviewsReminderService } from './reviews-reminder.service.js';
import { ReviewsSnapshotService } from './reviews-snapshot.service.js';
import { ReviewsController } from './reviews.controller.js';
import { ReviewsService } from './reviews.service.js';

@Module({
  imports: [
    AuthModule,
    EmailModule,
    SigningModule,
    NotificationsModule,
    OfstedModule,
    PdfModule,
    TypeOrmModule.forFeature([
      Review,
      ReviewRecord,
      ReviewSignature,
      ReviewReminderDispatch,
      Enrolment,
      PdfGenerationJob,
      User,
    ]),
  ],
  controllers: [ReviewsController],
  providers: [
    ReviewsService,
    ReviewRecordsService,
    ReviewsOverdueService,
    ReviewsReminderService,
    ReviewsCoSignService,
    ReviewsSnapshotService,
  ],
  exports: [
    TypeOrmModule,
    ReviewsService,
    ReviewsOverdueService,
    ReviewsReminderService,
  ],
})
export class ReviewsModule {}
