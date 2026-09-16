import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { runWithTenantContext } from '../../common/context/correlation-id-context.js';
import { EMAIL_JOB_SEND } from '../../email/email-job.constants.js';
import { EmailPayloadFactory } from '../../email/email-payload.factory.js';
import { EmailService } from '../../email/email.service.js';
import { QUEUE_EMAIL } from '../bullmq.constants.js';

import type { IEmailJobPayload } from '../../email/email-job.payload.js';

@Processor(QUEUE_EMAIL)
export class EmailSendProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailSendProcessor.name);

  constructor(
    private readonly emailPayloadFactory: EmailPayloadFactory,
    private readonly emailService: EmailService,
  ) {
    super();
  }

  /**
   * The job runs inside its own tenant store — what CorrelationIdMiddleware
   * gives a request. The values used to be set on a process-global fallback,
   * so two jobs interleaving on one worker read and wrote as each other's
   * organisation; each job now carries its own for the whole of its work.
   */
  async process(job: Job<IEmailJobPayload>): Promise<void> {
    return runWithTenantContext(
      {
        label: `email:${job.name}#${job.id ?? '?'}`,
      },
      () => this.processInContext(job),
    );
  }

  private async processInContext(job: Job<IEmailJobPayload>): Promise<void> {
    if (job.name !== EMAIL_JOB_SEND) {
      this.logger.warn(
        `Unknown job name "${job.name}" on ${QUEUE_EMAIL} queue (job ${job.id})`,
      );
      return;
    }

    const payload = this.emailPayloadFactory.fromJob(job.data);
    await this.emailService.sendEmail(payload);
  }
}
