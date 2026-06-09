import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OfstedModule } from '../ofsted/ofsted.module.js';
import { Standard } from '../programmes/entities/standard.entity.js';
import { RedisModule } from '../redis/redis.module.js';
import { StorageModule } from '../storage/storage.module.js';

import { EnrolmentKsbCoverage } from './entities/enrolment-ksb-coverage.entity.js';
import { KsEvidenceItem } from './entities/ks-evidence-item.entity.js';
import { KsEvidenceKsbMapping } from './entities/ks-evidence-ksb-mapping.entity.js';
import { KsbDefinition } from './entities/ksb-definition.entity.js';
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
    ]),
  ],
  controllers: [
    KsbDefinitionsController,
    KsEvidenceItemsController,
    PortfolioController,
  ],
  providers: [
    KsbDefinitionsService,
    KsEvidenceItemsService,
    KsEvidenceStatusService,
    KsEvidenceStorageService,
    PortfolioEnrolmentContext,
    PortfolioHeatmapService,
    PortfolioHeatmapCacheService,
  ],
  exports: [TypeOrmModule, KsbDefinitionsService, KsEvidenceItemsService],
})
export class PortfolioModule {}
