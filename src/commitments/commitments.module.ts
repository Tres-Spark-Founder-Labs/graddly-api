import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { EmailModule } from '../email/email.module.js';
import { EnrolmentsModule } from '../enrolments/enrolments.module.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OfstedModule } from '../ofsted/ofsted.module.js';
import { PdfGenerationJob } from '../pdf/entities/pdf-generation-job.entity.js';
import { PdfModule } from '../pdf/pdf.module.js';
import { SigningModule } from '../signing/signing.module.js';
import { User } from '../users/entities/user.entity.js';

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
      User,
    ]),
  ],
  controllers: [CommitmentsController],
  providers: [
    CommitmentStatementsService,
    CommitmentStatementStatusService,
    CommitmentsCoSignService,
    CommitmentChaseService,
  ],
  exports: [TypeOrmModule, CommitmentStatementsService, CommitmentChaseService],
})
export class CommitmentsModule {}
