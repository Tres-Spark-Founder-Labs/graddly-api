import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { ReportingModule } from '../reporting/reporting.module.js';

import { SurveyCampaign } from './entities/survey-campaign.entity.js';
import { SurveyInvitation } from './entities/survey-invitation.entity.js';
import { SurveyTemplate } from './entities/survey-template.entity.js';
import { PublicSurveysController } from './public-surveys.controller.js';
import { SurveysController } from './surveys.controller.js';
import { SurveysService } from './surveys.service.js';

@Module({
  imports: [
    AuthModule,
    forwardRef(() => ReportingModule),
    TypeOrmModule.forFeature([
      SurveyTemplate,
      SurveyCampaign,
      SurveyInvitation,
    ]),
  ],
  controllers: [SurveysController, PublicSurveysController],
  providers: [SurveysService],
  exports: [SurveysService],
})
export class SurveysModule {}
