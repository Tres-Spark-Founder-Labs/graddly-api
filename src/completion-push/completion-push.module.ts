import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { DasModule } from '../das/das.module.js';

import { CompletionPushDispatchService } from './completion-push-dispatch.service.js';
import { CompletionPushController } from './completion-push.controller.js';
import { CompletionPushService } from './completion-push.service.js';
import { EnrolmentCompletionPush } from './entities/enrolment-completion-push.entity.js';

@Module({
  imports: [
    AuthModule,
    DasModule,
    TypeOrmModule.forFeature([EnrolmentCompletionPush]),
  ],
  controllers: [CompletionPushController],
  providers: [CompletionPushDispatchService, CompletionPushService],
  exports: [
    CompletionPushDispatchService,
    CompletionPushService,
    TypeOrmModule,
  ],
})
export class CompletionPushModule {}
