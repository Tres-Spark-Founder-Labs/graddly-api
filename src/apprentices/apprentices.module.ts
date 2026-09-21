import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { EnrolmentsModule } from '../enrolments/enrolments.module.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { PdfModule } from '../pdf/pdf.module.js';
import { WithdrawalPushModule } from '../withdrawal-push/withdrawal-push.module.js';

import { ApprenticeRosterService } from './apprentice-roster.service.js';
import { ApprenticesController } from './apprentices.controller.js';
import { ApprenticesService } from './apprentices.service.js';
import { Apprentice } from './entities/apprentice.entity.js';

@Module({
  imports: [
    AuthModule,
    WithdrawalPushModule,
    // F1.2.1 AC6 — the roster PDF composes the roster as the screen does and
    // goes through the shared PDF job pipeline.
    EnrolmentsModule,
    PdfModule,
    TypeOrmModule.forFeature([Apprentice, Organisation, Enrolment]),
  ],
  controllers: [ApprenticesController],
  providers: [ApprenticesService, ApprenticeRosterService],
  exports: [TypeOrmModule, ApprenticesService, ApprenticeRosterService],
})
export class ApprenticesModule {}
