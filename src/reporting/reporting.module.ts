import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { CommitmentStatementGroup } from '../commitments/entities/commitment-statement-group.entity.js';
import { DasModule } from '../das/das.module.js';
import { DasLevyBalance } from '../das/entities/das-levy-balance.entity.js';
import { EnrolmentsModule } from '../enrolments/enrolments.module.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { IlrLearnerRecord } from '../ilr/entities/ilr-learner-record.entity.js';
import { LearnersModule } from '../learners/learners.module.js';
import { LevyTransfer } from '../levy-exchange/entities/levy-transfer.entity.js';
import { LevyExchangeModule } from '../levy-exchange/levy-exchange.module.js';
import { OfstedModule } from '../ofsted/ofsted.module.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { OtjModule } from '../otj/otj.module.js';
import { PdfModule } from '../pdf/pdf.module.js';
import { Standard } from '../programmes/entities/standard.entity.js';
import { Review } from '../reviews/entities/review.entity.js';

import { CommitmentPipelineService } from './commitment-pipeline.service.js';
import { EmployerDashboardController } from './employer-dashboard.controller.js';
import { EmployerDashboardService } from './employer-dashboard.service.js';
import { EmployerDirectoryController } from './employer-directory.controller.js';
import { EmployerDirectoryService } from './employer-directory.service.js';
import { LevyRoiReportController } from './levy-roi-report.controller.js';
import { LevyRoiReportService } from './levy-roi-report.service.js';
import { LevyUtilisationController } from './levy-utilisation.controller.js';
import { LevyUtilisationService } from './levy-utilisation.service.js';
import { OtjProgressMetricsService } from './otj-progress-metrics.service.js';
import { ProviderDashboardController } from './provider-dashboard.controller.js';
import { ProviderDashboardService } from './provider-dashboard.service.js';
import { ReportingPortalService } from './reporting-portal.service.js';
import { SmeOverviewController } from './sme-overview.controller.js';
import { SmeOverviewService } from './sme-overview.service.js';

@Module({
  imports: [
    AuthModule,
    DasModule,
    LevyExchangeModule,
    OfstedModule,
    PdfModule,
    EnrolmentsModule,
    OtjModule,
    forwardRef(() => LearnersModule),
    TypeOrmModule.forFeature([
      Enrolment,
      Standard,
      Organisation,
      OrganisationMembership,
      LevyTransfer,
      OtjLogEntry,
      Review,
      CommitmentStatementGroup,
      DasLevyBalance,
      IlrLearnerRecord,
    ]),
  ],
  controllers: [
    LevyRoiReportController,
    LevyUtilisationController,
    EmployerDirectoryController,
    SmeOverviewController,
    EmployerDashboardController,
    ProviderDashboardController,
  ],
  providers: [
    ReportingPortalService,
    OtjProgressMetricsService,
    CommitmentPipelineService,
    LevyRoiReportService,
    LevyUtilisationService,
    EmployerDirectoryService,
    SmeOverviewService,
    EmployerDashboardService,
    ProviderDashboardService,
  ],
  exports: [
    LevyRoiReportService,
    ReportingPortalService,
    OtjProgressMetricsService,
    CommitmentPipelineService,
  ],
})
export class ReportingModule {}
