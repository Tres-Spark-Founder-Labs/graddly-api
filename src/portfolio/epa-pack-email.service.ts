import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { withRlsBootstrap } from '../common/context/correlation-id-context.js';
import { EpaPackReadyEmail } from '../email/payloads/epa-pack-ready.email.js';
import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { StorageService } from '../storage/storage.service.js';
import { User } from '../users/entities/user.entity.js';

import { EpaPackJob } from './entities/epa-pack-job.entity.js';
import { EpaPackJobStatus } from './enums/epa-pack-job-status.enum.js';

/**
 * What `sendDownloadLink` did. Only `queued` leaves the sent marker set.
 *
 *   queued         the email is on the email queue
 *   suppressed     the requester switched portfolio emails off (F3.4.3 AC3)
 *   already_sent   this job was emailed before — a re-delivered job
 *   not_completed  the job is not completed, so there is no link to send
 *   no_recipient   the requester has no email address
 */
export type EpaPackEmailOutcome =
  | 'queued'
  | 'suppressed'
  | 'already_sent'
  | 'not_completed'
  | 'no_recipient';

/**
 * F3.3.4 AC5 — "Download link is also sent by email for convenience".
 *
 * ── ONCE PER COMPLETED JOB ──────────────────────────────────────────────────
 *
 * The sent marker is `epa_pack_jobs.downloadEmailSentAt`, claimed with one
 * conditional UPDATE before anything is built or queued:
 *
 *     SET "downloadEmailSentAt" = now()
 *     WHERE id = :jobId AND status = 'completed' AND "downloadEmailSentAt" IS NULL
 *
 * Zero rows means someone already claimed it (a job BullMQ delivered twice —
 * a stalled worker, a retry after the ZIP was already uploaded) or the job is
 * not completed, and nothing is sent either way. The queue is not trusted for
 * this: a job id is unique per enqueue, not per delivery.
 *
 * The claim is released again on every outcome except `queued`, so the marker
 * means exactly "an email was queued at this time" — the API serves it and
 * the portal shows "we have also emailed you" from it, never from a guess.
 *
 * ── THE LINK'S LIFE ─────────────────────────────────────────────────────────
 *
 * The in-app link is presigned for S3_PRESIGN_DOWNLOAD_TTL_SECONDS (five
 * minutes by default) because it is made on demand for a signed-in person.
 * An emailed link has to survive until the email is opened, which is hours,
 * not minutes; but it is an unauthenticated URL to a person's evidence
 * sitting in an inbox, and a forwarded email or a compromised mailbox can use
 * it. EPA_PACK_EMAIL_LINK_TTL_SECONDS (default 24 hours, ceiling 7 days —
 * S3's own) is the compromise, and the email states it.
 */
@Injectable()
export class EpaPackEmailService {
  private readonly logger = new Logger(EpaPackEmailService.name);

  constructor(
    @InjectRepository(EpaPackJob)
    private readonly jobRepo: Repository<EpaPackJob>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly storage: StorageService,
    private readonly notificationsService: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  async sendDownloadLink(jobId: string): Promise<EpaPackEmailOutcome> {
    const claim = await this.jobRepo
      .createQueryBuilder()
      .update(EpaPackJob)
      .set({ downloadEmailSentAt: () => 'now()' })
      .where(
        'id = :jobId AND status = :status AND "downloadEmailSentAt" IS NULL',
        { jobId, status: EpaPackJobStatus.COMPLETED },
      )
      .execute();

    if (!claim.affected) {
      const job = await this.jobRepo.findOne({
        where: { id: jobId },
        select: ['id', 'status', 'downloadEmailSentAt'],
      });
      return job?.downloadEmailSentAt ? 'already_sent' : 'not_completed';
    }

    try {
      const outcome = await this.deliver(jobId);
      if (outcome !== 'queued') {
        await this.releaseClaim(jobId);
      }
      return outcome;
    } catch (error) {
      await this.releaseClaim(jobId);
      throw error;
    }
  }

  private async deliver(jobId: string): Promise<EpaPackEmailOutcome> {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (
      !job ||
      job.status !== EpaPackJobStatus.COMPLETED ||
      job.outputKey === null
    ) {
      // The claim proved the row was completed a moment ago; this is defence
      // against a completed job with nothing to link to.
      return 'not_completed';
    }

    /**
     * The requester's address and first name. Two named columns, the id from
     * the job row just read, under the rule on `withRlsBootstrap`: the job
     * runs as the requester today, but `users_select` would hide the row
     * from any other caller of this service, and the email would silently
     * reach nobody.
     */
    const requester = await withRlsBootstrap(() =>
      this.userRepo.findOne({
        where: { id: job.requestedByUserId, isDeleted: false },
        select: ['id', 'email', 'firstName'],
      }),
    );
    if (!requester?.email) {
      this.logger.warn(
        `EPA pack ${jobId}: requester ${job.requestedByUserId} has no email address; download link not emailed`,
      );
      return 'no_recipient';
    }

    const expiresInSeconds = this.config.get<number>(
      'app.epaPack.emailLinkTtlSeconds',
      86400,
    );
    const download = await this.storage.createDownloadUrl(
      job.organisationId,
      { key: job.outputKey },
      { expiresInSeconds },
    );

    const outcome = await this.notificationsService.sendEmail({
      userId: requester.id,
      type: NotificationType.PORTFOLIO,
      payload: EpaPackReadyEmail.create(this.config, {
        to: requester.email,
        firstName: requester.firstName ?? 'there',
        downloadUrl: download.downloadUrl,
        expiresAt: download.expiresAt,
      }),
    });
    return outcome;
  }

  private async releaseClaim(jobId: string): Promise<void> {
    await this.jobRepo.update(jobId, { downloadEmailSentAt: null });
  }
}
