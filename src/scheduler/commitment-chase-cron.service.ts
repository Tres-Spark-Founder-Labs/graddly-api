import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { CommitmentChaseService } from '../commitments/commitment-chase.service.js';

import { CronLockService } from './cron-lock.service.js';
import { COMMITMENT_CHASE_CRON_NAME } from './scheduler.constants.js';

@Injectable()
export class CommitmentChaseCronService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CommitmentChaseCronService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly cronLock: CronLockService,
    private readonly chaseService: CommitmentChaseService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>('app.cron.enabled', true)) {
      return;
    }
    if (!this.config.get<boolean>('app.cron.commitmentChaseEnabled', false)) {
      return;
    }

    const expression = this.config.get<string>(
      'app.cron.commitmentChaseSchedule',
      '0 6 * * *',
    );

    const job = new CronJob(expression, () => {
      void this.handleCommitmentChaseCron();
    });

    this.schedulerRegistry.addCronJob(COMMITMENT_CHASE_CRON_NAME, job);
    job.start();
    this.logger.log(
      `Registered "${COMMITMENT_CHASE_CRON_NAME}" cron (${expression})`,
    );
  }

  onModuleDestroy(): void {
    if (!this.schedulerRegistry.doesExist('cron', COMMITMENT_CHASE_CRON_NAME)) {
      return;
    }
    const job = this.schedulerRegistry.getCronJob(COMMITMENT_CHASE_CRON_NAME);
    void job.stop();
    this.schedulerRegistry.deleteCronJob(COMMITMENT_CHASE_CRON_NAME);
  }

  async handleCommitmentChaseCron(): Promise<void> {
    await this.cronLock.runExclusive(COMMITMENT_CHASE_CRON_NAME, async () => {
      const sent = await this.chaseService.sendDueChases();
      this.logger.log(`Commitment chase cron sent ${sent} reminder(s)`);
    });
  }
}
