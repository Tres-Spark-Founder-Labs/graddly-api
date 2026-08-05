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

import {
  getRlsBootstrap,
  setRlsBootstrap,
} from '../common/context/correlation-id-context.js';
import { DasSyncDispatchService } from '../das/das-sync-dispatch.service.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';

import { CronLockService } from './cron-lock.service.js';
import { DAS_SYNC_CRON_NAME } from './scheduler.constants.js';

@Injectable()
export class DasSyncCronService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DasSyncCronService.name);

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
    if (!this.config.get<boolean>('app.cron.dasSyncEnabled', false)) {
      return;
    }

    const expression = this.config.get<string>(
      'app.cron.dasSyncSchedule',
      '*/15 * * * *',
    );

    const job = new CronJob(expression, () => {
      void this.handleDasSyncCron();
    });

    this.schedulerRegistry.addCronJob(DAS_SYNC_CRON_NAME, job);
    job.start();
    this.logger.log(`Registered "${DAS_SYNC_CRON_NAME}" cron (${expression})`);
  }

  onModuleDestroy(): void {
    if (!this.schedulerRegistry.doesExist('cron', DAS_SYNC_CRON_NAME)) {
      return;
    }
    const job = this.schedulerRegistry.getCronJob(DAS_SYNC_CRON_NAME);
    void job.stop();
    this.schedulerRegistry.deleteCronJob(DAS_SYNC_CRON_NAME);
  }

  async handleDasSyncCron(): Promise<void> {
    await this.cronLock.runExclusive(DAS_SYNC_CRON_NAME, async () => {
      /**
       * Security hardening pass, item 7 — cron sweep needs bootstrap.
       *
       * A cron has no signed-in user, so the organisation-keyed policy on
       * organisations matched nothing and this returned zero rows for every
       * organisation while the job reported success.
       */
      const previousBootstrap = getRlsBootstrap();
      setRlsBootstrap(true);
      let organisations;
      try {
        organisations = await this.organisationsRepo.find({
          where: { isDeleted: false, ukprn: Not(IsNull()) },
          select: ['id'],
        });
      } finally {
        setRlsBootstrap(previousBootstrap);
      }

      for (const organisation of organisations) {
        await this.dispatch.enqueueSync({ organisationId: organisation.id });
      }

      this.logger.log(
        `Queued DAS sync jobs for ${organisations.length} org(s)`,
      );
    });
  }
}
