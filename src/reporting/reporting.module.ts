import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { CommitmentStatementGroup } from '../commitments/entities/commitment-statement-group.entity.js';
import { DasModule } from '../das/das.module.js';
import { EnrolmentsModule } from '../enrolments/enrolments.module.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { LevyTransfer } from '../levy-exchange/entities/levy-transfer.entity.js';
import { LevyExchangeModule } from '../levy-exchange/levy-exchange.module.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { OtjModule } from '../otj/otj.module.js';
import { PdfModule } from '../pdf/pdf.module.js';
import { Standard } from '../programmes/entities/standard.entity.js';

import { CommitmentPipelineService } from './commitment-pipeline.service.js';
import { EmployerDirectoryController } from './employer-directory.controller.js';
import { EmployerDirectoryService } from './employer-directory.service.js';
import { LevyRoiReportController } from './levy-roi-report.controller.js';
import { LevyRoiReportService } from './levy-roi-report.service.js';
import { OtjProgressMetricsService } from './otj-progress-metrics.service.js';
import { ReportingPortalService } from './reporting-portal.service.js';

@Module({
  imports: [
    AuthModule,
    DasModule,
    LevyExchangeModule,
    PdfModule,
    EnrolmentsModule,
    OtjModule,
    TypeOrmModule.forFeature([
      Enrolment,
      Standard,
      Organisation,
      OrganisationMembership,
      LevyTransfer,
      OtjLogEntry,
      CommitmentStatementGroup,
    ]),
  ],
  controllers: [LevyRoiReportController, EmployerDirectoryController],
  providers: [
    ReportingPortalService,
    OtjProgressMetricsService,
    CommitmentPipelineService,
    LevyRoiReportService,
    EmployerDirectoryService,
  ],
  exports: [
    LevyRoiReportService,
    ReportingPortalService,
    OtjProgressMetricsService,
  ],
})
export class ReportingModule {}
