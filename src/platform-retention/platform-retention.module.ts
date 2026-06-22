import { Module } from '@nestjs/common';

import { DataRetentionModule } from '../data-retention/data-retention.module.js';
import { PlatformGdprModule } from '../platform-gdpr/platform-gdpr.module.js';

import { PlatformRetentionController } from './platform-retention.controller.js';
import { PlatformRetentionService } from './platform-retention.service.js';

@Module({
  imports: [DataRetentionModule, PlatformGdprModule],
  controllers: [PlatformRetentionController],
  providers: [PlatformRetentionService],
})
export class PlatformRetentionModule {}
