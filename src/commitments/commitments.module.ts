import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Apprentice } from '../apprentices/entities/apprentice.entity.js';
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
    ]),
  ],
  controllers: [CommitmentsController],
  providers: [
    CommitmentBoardService,
    CommitmentStatementsService,
    CommitmentStatementStatusService,
    CommitmentsCoSignService,
    CommitmentChaseService,
  ],
  exports: [TypeOrmModule, CommitmentStatementsService, CommitmentChaseService],
})
export class CommitmentsModule {}
