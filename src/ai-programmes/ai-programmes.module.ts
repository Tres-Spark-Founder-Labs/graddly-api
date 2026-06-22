import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ApprenticesModule } from '../apprentices/apprentices.module.js';
import { Apprentice } from '../apprentices/entities/apprentice.entity.js';
import { AuthModule } from '../auth/auth.module.js';
import { EnrolmentsModule } from '../enrolments/enrolments.module.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { Programme } from '../programmes/entities/programme.entity.js';
import { Standard } from '../programmes/entities/standard.entity.js';
import { ProgrammesModule } from '../programmes/programmes.module.js';
import { ReportingModule } from '../reporting/reporting.module.js';

import { AiProgrammeCatalogueController } from './ai-programme-catalogue.controller.js';
import { AiProgrammeCatalogueService } from './ai-programme-catalogue.service.js';
import { AiProgrammeEnrolmentController } from './ai-programme-enrolment.controller.js';
import { AiProgrammeEnrolmentService } from './ai-programme-enrolment.service.js';
import { AiProgrammeProgressController } from './ai-programme-progress.controller.js';
import { AiProgrammeProgressService } from './ai-programme-progress.service.js';
import { AiProgrammeCompletion } from './entities/ai-programme-completion.entity.js';
import { AiProgrammeModule } from './entities/ai-programme-module.entity.js';
import { AiProgrammeProgress } from './entities/ai-programme-progress.entity.js';

@Module({
  imports: [
    AuthModule,
    ReportingModule,
    EnrolmentsModule,
    ApprenticesModule,
    ProgrammesModule,
    TypeOrmModule.forFeature([
      Programme,
      Standard,
      Enrolment,
      Apprentice,
      AiProgrammeModule,
      AiProgrammeProgress,
      AiProgrammeCompletion,
    ]),
  ],
  controllers: [
    AiProgrammeCatalogueController,
    AiProgrammeEnrolmentController,
    AiProgrammeProgressController,
  ],
  providers: [
    AiProgrammeCatalogueService,
    AiProgrammeEnrolmentService,
    AiProgrammeProgressService,
  ],
  exports: [
    AiProgrammeCatalogueService,
    AiProgrammeEnrolmentService,
    AiProgrammeProgressService,
  ],
})
export class AiProgrammesModule {}
