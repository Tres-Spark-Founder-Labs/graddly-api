import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Apprentice } from '../apprentices/entities/apprentice.entity.js';
import { AuthModule } from '../auth/auth.module.js';
import { EmailModule } from '../email/email.module.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OfstedModule } from '../ofsted/ofsted.module.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { StorageModule } from '../storage/storage.module.js';
import { User } from '../users/entities/user.entity.js';

import { OtjLogEntry } from './entities/otj-log-entry.entity.js';
import { OtjLogEntriesController } from './otj-log-entries.controller.js';
import { OtjLogEntriesService } from './otj-log-entries.service.js';
import { OtjPaceService } from './otj-pace.service.js';

@Module({
  imports: [
    AuthModule,
    EmailModule,
    NotificationsModule,
    OfstedModule,
    StorageModule,
    TypeOrmModule.forFeature([
      OtjLogEntry,
      Enrolment,
      Organisation,
      User,
      // F1.2.4 AC4 — the manager alert names the apprentice it is about.
      Apprentice,
    ]),
  ],
  controllers: [OtjLogEntriesController],
  providers: [OtjLogEntriesService, OtjPaceService],
  exports: [TypeOrmModule, OtjLogEntriesService, OtjPaceService],
})
export class OtjModule {}
