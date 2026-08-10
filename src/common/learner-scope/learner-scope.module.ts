import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Enrolment } from '../../enrolments/entities/enrolment.entity.js';

import { LearnerScopeService } from './learner-scope.service.js';

/**
 * Global so that any service can narrow its own query without every feature
 * module having to import this one — and, more importantly, so there is exactly
 * one implementation of "who is this learner and what is theirs" rather than a
 * copy per module.
 *
 * It registers `Enrolment` via `TypeOrmModule.forFeature` directly instead of
 * importing `EnrolmentsModule`. `EnrolmentsModule` pulls in messaging,
 * completion push and provisioning; depending on it from something this widely
 * imported would create import cycles for no benefit, since the only thing
 * needed here is one repository.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Enrolment])],
  providers: [LearnerScopeService],
  exports: [LearnerScopeService],
})
export class LearnerScopeModule {}
