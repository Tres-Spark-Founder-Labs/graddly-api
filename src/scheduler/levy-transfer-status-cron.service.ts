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
import { In, Repository } from 'typeorm';

import {
  getRlsBootstrap,
  setRlsBootstrap,
} from '../common/context/correlation-id-context.js';
import { LevyTransfer } from '../levy-exchange/entities/levy-transfer.entity.js';
import { LevyTransferStatus } from '../levy-exchange/enums/levy-transfer-status.enum.js';
import { LevyTransferService } from '../levy-exchange/services/levy-transfer.service.js';

import { CronLockService } from './cron-lock.service.js';
import { LEVY_TRANSFER_STATUS_CRON_NAME } from './scheduler.constants.js';

@Injectable()
export class LevyTransferStatusCronService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(LevyTransferStatusCronService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly cronLock: CronLockService,
    private readonly transferService: LevyTransferService,
    @InjectRepository(LevyTransfer)
    private readonly transferRepo: Repository<LevyTransfer>,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>('app.cron.enabled', true)) {
      return;
    }
    if (
      !this.config.get<boolean>('app.cron.levyTransferStatusEnabled', false)
    ) {
      return;
    }

    const expression = this.config.get<string>(
      'app.cron.levyTransferStatusSchedule',
      '0 3 * * *',
    );

    const job = new CronJob(expression, () => {
      void this.handleLevyTransferStatusCron();
    });

    this.schedulerRegistry.addCronJob(LEVY_TRANSFER_STATUS_CRON_NAME, job);
    job.start();
    this.logger.log(
      `Registered "${LEVY_TRANSFER_STATUS_CRON_NAME}" cron (${expression})`,
    );
  }

  onModuleDestroy(): void {
    if (
      !this.schedulerRegistry.doesExist('cron', LEVY_TRANSFER_STATUS_CRON_NAME)
    ) {
      return;
    }
    const job = this.schedulerRegistry.getCronJob(
      LEVY_TRANSFER_STATUS_CRON_NAME,
    );
    void job.stop();
    this.schedulerRegistry.deleteCronJob(LEVY_TRANSFER_STATUS_CRON_NAME);
  }

  async handleLevyTransferStatusCron(): Promise<void> {
    await this.cronLock.runExclusive(
      LEVY_TRANSFER_STATUS_CRON_NAME,
      async () => {
        /**
         * Security hardening pass, item 7 — cron sweep needs bootstrap.
         *
         * `levy_transfers_select` matches on donor or recipient organisation.
         * A cron has neither, so this returned zero transfers and no in-flight
         * ESFA transfer was ever polled for a status change — while the job
         * logged a clean run.
         */
        const previousBootstrap = getRlsBootstrap();
        setRlsBootstrap(true);
        let transfers: LevyTransfer[];
        try {
          transfers = await this.transferRepo.find({
            where: {
              isDeleted: false,
              status: In([
                LevyTransferStatus.CONFIRMED,
                LevyTransferStatus.ACTIVE,
                LevyTransferStatus.PENDING_ESFA,
              ]),
            },
          });
        } finally {
          setRlsBootstrap(previousBootstrap);
        }

        let synced = 0;
        for (const transfer of transfers) {
          if (!transfer.esfaTransferReference) {
            continue;
          }
          await this.transferService.syncTransferStatusFromDas(transfer);
          synced += 1;
        }

        this.logger.log(
          `Synced DAS transfer status for ${synced}/${transfers.length} transfer(s)`,
        );
      },
    );
  }
}
