import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { DasModule } from '../das/das.module.js';

import { EnrolmentPushDispatchService } from './enrolment-push-dispatch.service.js';
import { EnrolmentPushController } from './enrolment-push.controller.js';
import { EnrolmentPushService } from './enrolment-push.service.js';
import { EnrolmentSubmissionPush } from './entities/enrolment-submission-push.entity.js';

@Module({
  imports: [
    AuthModule,
    DasModule,
    TypeOrmModule.forFeature([EnrolmentSubmissionPush]),
  ],
  controllers: [EnrolmentPushController],
  providers: [EnrolmentPushDispatchService, EnrolmentPushService],
  exports: [EnrolmentPushDispatchService, EnrolmentPushService, TypeOrmModule],
})
export class EnrolmentPushModule {}
