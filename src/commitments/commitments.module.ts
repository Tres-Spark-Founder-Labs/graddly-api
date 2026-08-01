import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Apprentice } from '../apprentices/entities/apprentice.entity.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuditLogEntry } from '../audit/entities/audit-log-entry.entity.js';
import { AuthModule } from '../auth/auth.module.js';
import { EmailModule } from '../email/email.module.js';
import { EnrolmentsModule } from '../enrolments/enrolments.module.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OfstedModule } from '../ofsted/ofsted.module.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { PdfGenerationJob } from '../pdf/entities/pdf-generation-job.entity.js';
import { PdfModule } from '../pdf/pdf.module.js';
import { Standard } from '../programmes/entities/standard.entity.js';
import { SigningModule } from '../signing/signing.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { User } from '../users/entities/user.entity.js';

import { CommitmentAuditTrailService } from './commitment-audit-trail.service.js';
import { CommitmentBoardService } from './commitment-board.service.js';
import { CommitmentChaseService } from './commitment-chase.service.js';
import { CommitmentStatementStatusService } from './commitment-statement-status.service.js';
import { CommitmentStatementsService } from './commitment-statements.service.js';
import { CommitmentsCoSignService } from './commitments-co-sign.service.js';
import { CommitmentsController } from './commitments.controller.js';
import { CommitmentChaseDispatch } from './entities/commitment-chase-dispatch.entity.js';
import { CommitmentSignature } from './entities/commitment-signature.entity.js';
import { CommitmentStatementGroup } from './entities/commitment-statement-group.entity.js';
import { CommitmentStatement } from './entities/commitment-statement.entity.js';

@Module({
  imports: [
    StorageModule,
    AuditModule,
    AuthModule,
    EnrolmentsModule,
    SigningModule,
    NotificationsModule,
    EmailModule,
    OfstedModule,
    PdfModule,
    TypeOrmModule.forFeature([
      CommitmentStatementGroup,
      CommitmentStatement,
      CommitmentSignature,
      CommitmentChaseDispatch,
      Enrolment,
      PdfGenerationJob,
      Apprentice,
      Organisation,
      Standard,
      User,
      // F1.3.3 AC3 — the trail export reads audit rows directly; it cannot go
      // through AuditExportService, which is paginated and org-scoped.
      AuditLogEntry,
    ]),
  ],
  controllers: [CommitmentsController],
  providers: [
    CommitmentAuditTrailService,
    CommitmentBoardService,
    CommitmentStatementsService,
    CommitmentStatementStatusService,
    CommitmentsCoSignService,
    CommitmentChaseService,
  ],
  exports: [
    TypeOrmModule,
    CommitmentStatementsService,
    CommitmentChaseService,
    // Consumed by the PDF worker, which lives in BullmqModule.
    CommitmentAuditTrailService,
  ],
})
export class CommitmentsModule {}
