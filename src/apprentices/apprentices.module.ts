import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { WithdrawalPushModule } from '../withdrawal-push/withdrawal-push.module.js';

import { ApprenticesController } from './apprentices.controller.js';
import { ApprenticesService } from './apprentices.service.js';
import { Apprentice } from './entities/apprentice.entity.js';

@Module({
  imports: [
    AuthModule,
    WithdrawalPushModule,
    TypeOrmModule.forFeature([Apprentice, Organisation]),
  ],
  controllers: [ApprenticesController],
  providers: [ApprenticesService],
  exports: [TypeOrmModule, ApprenticesService],
})
export class ApprenticesModule {}
