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
import { Repository } from 'typeorm';

import { DigestDispatchService } from '../notifications/digest-dispatch.service.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { OtjLogStatus } from '../otj/enums/otj-log-status.enum.js';

import { CronLockService } from './cron-lock.service.js';
import { DIGEST_CRON_NAME } from './scheduler.constants.js';

@Injectable()
export class DigestCronService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DigestCronService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly cronLock: CronLockService,
    private readonly digestDispatch: DigestDispatchService,
    @InjectRepository(OtjLogEntry)
    private readonly otjLogRepo: Repository<OtjLogEntry>,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>('app.cron.enabled', true)) {
      return;
    }

    if (!this.config.get<boolean>('app.cron.digestEnabled', false)) {
      return;
    }

    const expression = this.config.get<string>(
      'app.cron.digestSchedule',
      '0 8 * * *',
    );

    /**
     * F1.2.3 AC6 — "every Monday at 08:00 GMT".
     *
     * The zone is passed explicitly because `new CronJob(expression, onTick)`
     * evaluates the expression in the server's local time. Without it, "08:00"
     * is whatever the host's clock calls 08:00 — the same build delivers at a
     * different hour depending on where it is deployed, and there is nothing
     * in the code to reveal that.
     *
     * The schedule itself is daily, not Monday-only, because AC7 lets each
     * manager choose daily/weekly/off. A Monday-only job cannot serve a daily
     * subscriber, so the cadence filter moved to send time where the
     * per-user preference is known.
     */
    const timeZone = this.config.get<string>(
      'app.cron.digestTimeZone',
      'Europe/London',
    );

    const job = new CronJob(
      expression,
      () => {
        void this.handleDigestCron();
      },
      null,
      false,
      timeZone,
    );

    this.schedulerRegistry.addCronJob(DIGEST_CRON_NAME, job);
    job.start();

    this.logger.log(
      `Registered "${DIGEST_CRON_NAME}" cron (${expression} ${timeZone})`,
    );
  }

  onModuleDestroy(): void {
    if (!this.schedulerRegistry.doesExist('cron', DIGEST_CRON_NAME)) {
      return;
    }

    const job = this.schedulerRegistry.getCronJob(DIGEST_CRON_NAME);
    void job.stop();
    this.schedulerRegistry.deleteCronJob(DIGEST_CRON_NAME);
  }

  async handleDigestCron(): Promise<void> {
    await this.cronLock.runExclusive(DIGEST_CRON_NAME, async () => {
      const rows = await this.otjLogRepo
        .createQueryBuilder('entry')
        .select('DISTINCT entry.organisationId', 'organisationId')
        .where('entry.status = :status', { status: OtjLogStatus.SUBMITTED })
        .andWhere('entry.isDeleted = false')
        .getRawMany<{ organisationId: string }>();

      for (const row of rows) {
        await this.digestDispatch.enqueueWeeklyOtjDigest({
          organisationId: row.organisationId,
        });
      }

      this.logger.log(
        `Digest cron queued weekly OTJ digest for ${rows.length} org(s)`,
      );
    });
  }
}
