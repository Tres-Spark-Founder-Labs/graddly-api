import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { ReportingModule } from '../reporting/reporting.module.js';

import { EmployerVisitsController } from './employer-visits.controller.js';
import { EmployerVisitsService } from './employer-visits.service.js';
import { EmployerVisitLearner } from './entities/employer-visit-learner.entity.js';
import { EmployerVisit } from './entities/employer-visit.entity.js';

@Module({
  imports: [
    AuthModule,
    // forwardRef: reporting's employer directory consumes this module for
    // F2.4.1's lastVisitDate, and this module uses reporting's portal guard.
    forwardRef(() => ReportingModule),
    TypeOrmModule.forFeature([EmployerVisit, EmployerVisitLearner, Enrolment]),
  ],
  controllers: [EmployerVisitsController],
  providers: [EmployerVisitsService],
  exports: [EmployerVisitsService],
})
export class EmployerVisitsModule {}
