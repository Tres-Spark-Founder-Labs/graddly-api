import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { CommitmentStatementGroup } from '../commitments/entities/commitment-statement-group.entity.js';
import { DasModule } from '../das/das.module.js';
import { DasLevyBalance } from '../das/entities/das-levy-balance.entity.js';
import { EmailModule } from '../email/email.module.js';
import { EnrolmentsModule } from '../enrolments/enrolments.module.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EpaOutcomeRecord } from '../enrolments/entities/epa-outcome.entity.js';
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
import { User } from '../users/entities/user.entity.js';

import { CommitmentPipelineService } from './commitment-pipeline.service.js';
import { EmployerDashboardController } from './employer-dashboard.controller.js';
import { EmployerDashboardService } from './employer-dashboard.service.js';
import { EmployerDirectoryController } from './employer-directory.controller.js';
import { EmployerDirectoryService } from './employer-directory.service.js';
import { ReportSubscription } from './entities/report-subscription.entity.js';
import { LevyRoiMonthlyReportService } from './levy-roi-monthly-report.service.js';
import { LevyRoiReportController } from './levy-roi-report.controller.js';
import { LevyRoiReportService } from './levy-roi-report.service.js';
import { LevyRoiYearOnYearService } from './levy-roi-year-on-year.service.js';
import { LevyUtilisationController } from './levy-utilisation.controller.js';
import { LevyUtilisationService } from './levy-utilisation.service.js';
import { OtjProgressMetricsService } from './otj-progress-metrics.service.js';
import { OutcomeMetricsModule } from './outcome-metrics.module.js';
import { ProviderDashboardController } from './provider-dashboard.controller.js';
import { ProviderDashboardService } from './provider-dashboard.service.js';
import { ReportSubscriptionsService } from './report-subscriptions.service.js';
import { ReportingPortalService } from './reporting-portal.service.js';
import { SmeOverviewController } from './sme-overview.controller.js';
import { SmeOverviewService } from './sme-overview.service.js';

@Module({
  imports: [
    AuthModule,
    DasModule,
    // F1.4.1 AC5 — LevyRoiMonthlyReportService queues the scheduled report
    // through EmailDispatchService.
    EmailModule,
    LevyExchangeModule,
    OfstedModule,
    PdfModule,
    EnrolmentsModule,
    OtjModule,
    forwardRef(() => LearnersModule),
    OutcomeMetricsModule,
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
      // F1.4.1 AC1 — EPA pass rate, from outcomes the provider records.
      EpaOutcomeRecord,
      User,
      // F1.4.1 AC5 — the scheduled-report distribution list.
      ReportSubscription,
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
    LevyRoiYearOnYearService,
    ReportSubscriptionsService,
    LevyRoiMonthlyReportService,
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
    // F1.4.1 AC5 — consumed by LevyRoiMonthlyCronService in SchedulerModule.
    LevyRoiMonthlyReportService,
    ReportSubscriptionsService,
  ],
})
export class ReportingModule {}
