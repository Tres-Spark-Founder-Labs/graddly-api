import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { CommitmentStatementGroup } from '../commitments/entities/commitment-statement-group.entity.js';
import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OfstedModule } from '../ofsted/ofsted.module.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { PdfGenerationJob } from '../pdf/entities/pdf-generation-job.entity.js';
import { Standard } from '../programmes/entities/standard.entity.js';
import { RedisModule } from '../redis/redis.module.js';
import { Review } from '../reviews/entities/review.entity.js';
import { StorageModule } from '../storage/storage.module.js';

import { EnrolmentKsbCoverage } from './entities/enrolment-ksb-coverage.entity.js';
import { EpaPackJob } from './entities/epa-pack-job.entity.js';
import { KsEvidenceItem } from './entities/ks-evidence-item.entity.js';
import { KsEvidenceKsbMapping } from './entities/ks-evidence-ksb-mapping.entity.js';
import { KsbDefinition } from './entities/ksb-definition.entity.js';
import { EpaPackBuilderService } from './epa-pack-builder.service.js';
import { EpaPackDispatchService } from './epa-pack-dispatch.service.js';
import { EpaPackJobsController } from './epa-pack-jobs.controller.js';
import { EpaPackJobsService } from './epa-pack-jobs.service.js';
import { KsEvidenceItemsController } from './ks-evidence-items.controller.js';
import { KsEvidenceItemsService } from './ks-evidence-items.service.js';
import { KsEvidenceStatusService } from './ks-evidence-status.service.js';
import { KsEvidenceStorageService } from './ks-evidence-storage.service.js';
import { KsbDefinitionsController } from './ksb-definitions.controller.js';
import { KsbDefinitionsService } from './ksb-definitions.service.js';
import { PortfolioEnrolmentContext } from './portfolio-enrolment.context.js';
import { PortfolioHeatmapCacheService } from './portfolio-heatmap-cache.service.js';
import { PortfolioHeatmapService } from './portfolio-heatmap.service.js';
import { PortfolioController } from './portfolio.controller.js';

@Module({
  imports: [
    AuthModule,
    NotificationsModule,
    OfstedModule,
    StorageModule,
    RedisModule,
    TypeOrmModule.forFeature([
      KsbDefinition,
      KsEvidenceItem,
      KsEvidenceKsbMapping,
      EnrolmentKsbCoverage,
      Enrolment,
      Standard,
      EpaPackJob,
      Review,
      PdfGenerationJob,
      CommitmentStatement,
      CommitmentStatementGroup,
      OtjLogEntry,
    ]),
  ],
  controllers: [
    KsbDefinitionsController,
    KsEvidenceItemsController,
    PortfolioController,
    EpaPackJobsController,
  ],
  providers: [
    KsbDefinitionsService,
    KsEvidenceItemsService,
    KsEvidenceStatusService,
    KsEvidenceStorageService,
    PortfolioEnrolmentContext,
    PortfolioHeatmapService,
    PortfolioHeatmapCacheService,
    EpaPackDispatchService,
    EpaPackJobsService,
    EpaPackBuilderService,
  ],
  exports: [
    TypeOrmModule,
    KsbDefinitionsService,
    KsEvidenceItemsService,
    EpaPackBuilderService,
    EpaPackDispatchService,
    PortfolioEnrolmentContext,
  ],
})
export class PortfolioModule {}
