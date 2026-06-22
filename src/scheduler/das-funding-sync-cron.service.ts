import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { CronJob } from 'cron';
import { IsNull, Not, Repository } from 'typeorm';

import { DasSyncDispatchService } from '../das/das-sync-dispatch.service.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';

import { CronLockService } from './cron-lock.service.js';
import { DAS_FUNDING_SYNC_CRON_NAME } from './scheduler.constants.js';

@Injectable()
export class DasFundingSyncCronService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DasFundingSyncCronService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly cronLock: CronLockService,
    private readonly dispatch: DasSyncDispatchService,
    @InjectRepository(Organisation)
    private readonly organisationsRepo: Repository<Organisation>,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>('app.cron.enabled', true)) {
      return;
    }
    if (!this.config.get<boolean>('app.cron.dasFundingSyncEnabled', false)) {
      return;
    }

    const expression = this.config.get<string>(
      'app.cron.dasFundingSyncSchedule',
      '0 2 * * *',
    );

    const job = new CronJob(expression, () => {
      void this.handleFundingSyncCron();
    });

    this.schedulerRegistry.addCronJob(DAS_FUNDING_SYNC_CRON_NAME, job);
    job.start();
    this.logger.log(`Registered ${DAS_FUNDING_SYNC_CRON_NAME} (${expression})`);
  }

  onModuleDestroy(): void {
    if (!this.schedulerRegistry.doesExist('cron', DAS_FUNDING_SYNC_CRON_NAME)) {
      return;
    }
    const job = this.schedulerRegistry.getCronJob(DAS_FUNDING_SYNC_CRON_NAME);
    void job.stop();
    this.schedulerRegistry.deleteCronJob(DAS_FUNDING_SYNC_CRON_NAME);
  }

  async handleFundingSyncCron(): Promise<void> {
    await this.cronLock.runExclusive(DAS_FUNDING_SYNC_CRON_NAME, async () => {
      const organisations = await this.organisationsRepo.find({
        where: { isDeleted: false, ukprn: Not(IsNull()) },
        select: ['id'],
      });

      for (const organisation of organisations) {
        await this.dispatch.enqueueFundingSync({
          organisationId: organisation.id,
          requestedByUserId: 'system-das-funding-sync',
        });
      }

      this.logger.log(
        `Queued DAS funding sync jobs for ${organisations.length} org(s)`,
      );
    });
  }
}
