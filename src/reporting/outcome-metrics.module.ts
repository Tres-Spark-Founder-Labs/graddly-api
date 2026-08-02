import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EpaOutcomeRecord } from '../enrolments/entities/epa-outcome.entity.js';
import { Review } from '../reviews/entities/review.entity.js';

import { EpaOutcomeMetricsService } from './epa-outcome-metrics.service.js';
import { LearnerOutcomeMetricsService } from './learner-outcome-metrics.service.js';

/**
 * Learner-outcome arithmetic, with no feature module underneath it.
 *
 * These two services answer questions — *what fraction of our reviews
 * happened on time, how many learners left, what share passed end-point
 * assessment* — that both `ReportingModule` (employer provider comparison,
 * F1.4.2) and `OfstedModule` (the SAR, F2.1.3) need.
 *
 * They live here rather than in `ReportingModule` because `ReportingModule`
 * already imports `OfstedModule`, so having Ofsted import Reporting back
 * closed a cycle that Nest resolves to `undefined` at scan time. `forwardRef`
 * would have silenced it; a module that depends on nothing but repositories
 * removes it, and is the honest description of what these services are.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Review, EpaOutcomeRecord])],
  providers: [LearnerOutcomeMetricsService, EpaOutcomeMetricsService],
  exports: [LearnerOutcomeMetricsService, EpaOutcomeMetricsService],
})
export class OutcomeMetricsModule {}
