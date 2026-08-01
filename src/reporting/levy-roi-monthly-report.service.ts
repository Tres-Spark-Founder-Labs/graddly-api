import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import {
  getRlsBootstrap,
  setRlsBootstrap,
} from '../common/context/correlation-id-context.js';
import { EmailDispatchService } from '../email/email-dispatch.service.js';
import { EmailTemplate } from '../email/email-template.enum.js';
import { SerializedEmailPayload } from '../email/payloads/serialized-email.payload.js';
import { User } from '../users/entities/user.entity.js';

import { LevyRoiReportService } from './levy-roi-report.service.js';
import { ReportSubscriptionsService } from './report-subscriptions.service.js';

/**
 * F1.4.1 AC5 — sends the monthly levy ROI report to its subscribers.
 *
 * The email carries the headline figures and a link into the portal rather
 * than an attached PDF. The PDF is generated asynchronously through the job
 * queue and lands in object storage behind a short-lived presigned URL; that
 * URL would expire long before a monthly email is read, and posting a
 * long-lived one into an inbox turns a board report into an unauthenticated
 * link anyone forwarded it to can open. AC4's PDF stays where a signed-in
 * user can fetch a fresh one.
 */
@Injectable()
export class LevyRoiMonthlyReportService {
  private readonly logger = new Logger(LevyRoiMonthlyReportService.name);

  constructor(
    private readonly subscriptionsService: ReportSubscriptionsService,
    private readonly roiReportService: LevyRoiReportService,
    private readonly emailDispatchService: EmailDispatchService,
    private readonly config: ConfigService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /** Returns how many emails were queued. */
  async sendMonthlyReports(now: Date = new Date()): Promise<number> {
    /**
     * The cron runs with no organisation context, so every read below would
     * match no rows under RLS. Bootstrap is set for the duration of the
     * sweep, exactly as the other cron-driven services do — the tenant
     * scoping that matters is applied per organisation as we iterate.
     */
    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    try {
      const subscriptions = await this.subscriptionsService.listAllEnabled();
      if (subscriptions.length === 0) {
        return 0;
      }

      const byOrganisation = new Map<string, typeof subscriptions>();
      for (const subscription of subscriptions) {
        const bucket = byOrganisation.get(subscription.organisationId) ?? [];
        bucket.push(subscription);
        byOrganisation.set(subscription.organisationId, bucket);
      }

      let queued = 0;
      for (const [organisationId, orgSubscriptions] of byOrganisation) {
        queued += await this.sendForOrganisation(
          organisationId,
          orgSubscriptions,
          now,
        );
      }
      return queued;
    } finally {
      setRlsBootstrap(previousBootstrap);
    }
  }

  private async sendForOrganisation(
    organisationId: string,
    subscriptions: Array<{ id: string; userId: string }>,
    now: Date,
  ): Promise<number> {
    let summary: Awaited<ReturnType<LevyRoiReportService['getSummary']>>;
    try {
      summary = await this.roiReportService.getSummary(organisationId);
    } catch (error) {
      /**
       * One organisation failing must not stop the sweep. `getSummary`
       * asserts the portal type, so a subscription left behind on an
       * organisation that has since changed type throws here rather than
       * silently emailing the wrong report.
       */
      this.logger.warn(
        `Monthly ROI report skipped for org ${organisationId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 0;
    }

    const users = await this.userRepo.findBy({
      id: In(subscriptions.map((s) => s.userId)),
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const appName = this.config.get<string>('app.email.appName', 'Graddly');
    // The recipient is an employer, so the link has to point at the employer
    // portal specifically — each portal is a separate deployment.
    const portalUrl = this.config
      .get<string>('app.frontend.portalUrls.employer', '')
      .replace(/\/$/, '');
    const reportUrl = `${portalUrl}/reports`;
    const yoy = summary.yearOnYear;

    const sentIds: string[] = [];
    for (const subscription of subscriptions) {
      const user = userMap.get(subscription.userId);
      if (!user?.email) continue;

      try {
        await this.emailDispatchService.enqueue(
          new SerializedEmailPayload(
            EmailTemplate.LEVY_ROI_MONTHLY,
            user.email,
            {
              firstName: user.firstName,
              appName,
              reportUrl,
              periodLabel: yoy.currentPeriod.label,
              activeApprenticeCount: summary.activeApprenticeCount,
              completionCount: summary.completionCount,
              // Formatted here rather than in the template: Nunjucks has no
              // locale-aware number filter configured, and a board email
              // showing "18500.5" reads as a defect.
              totalLevySpend: this.money(summary.totalLevySpendToDate),
              availableBalance:
                summary.availableBalance === null
                  ? null
                  : this.money(summary.availableBalance),
              averageCostPerCompletion:
                summary.averageCostPerCompletion === null
                  ? null
                  : this.money(summary.averageCostPerCompletion),
              // Null stays null so the template can say "not yet assessed"
              // rather than printing a misleading 0%.
              epaPassRate: summary.epaPassRate,
              epaAssessedCount: summary.epaAssessedCount,
              hasPriorPeriodData: yoy.hasPriorPeriodData,
              priorPeriodLabel: yoy.priorPeriod?.label ?? null,
              completionsChangePercent: yoy.completionsChangePercent,
              startsChangePercent: yoy.startsChangePercent,
            },
          ),
        );
        sentIds.push(subscription.id);
      } catch (error) {
        this.logger.warn(
          `Monthly ROI report failed for user ${subscription.userId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    await this.subscriptionsService.markSent(sentIds, now);
    return sentIds.length;
  }

  private money(value: number): string {
    return value.toLocaleString('en-GB', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}
