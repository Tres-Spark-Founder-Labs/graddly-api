import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { setRlsBootstrap } from '../common/context/correlation-id-context.js';
import { EmailDispatchService } from '../email/email-dispatch.service.js';
import { EmailTemplate } from '../email/email-template.enum.js';
import { SerializedEmailPayload } from '../email/payloads/serialized-email.payload.js';
import { User } from '../users/entities/user.entity.js';

import { LevyRoiMonthlyReportService } from './levy-roi-monthly-report.service.js';
import { LevyRoiReportService } from './levy-roi-report.service.js';
import { ReportSubscriptionsService } from './report-subscriptions.service.js';

jest.mock('../common/context/correlation-id-context.js', () => ({
  getRlsBootstrap: jest.fn(() => false),
  setRlsBootstrap: jest.fn(),
}));

describe('LevyRoiMonthlyReportService (F1.4.1 AC5)', () => {
  const subscriptionsService = {
    listAllEnabled: jest.fn(),
    markSent: jest.fn(),
  };
  const roiReportService = { getSummary: jest.fn() };
  const emailDispatchService = { enqueue: jest.fn() };
  const userRepo = { findBy: jest.fn() };

  let service: LevyRoiMonthlyReportService;

  const summary = {
    activeApprenticeCount: 12,
    completionCount: 8,
    totalLevySpendToDate: 250000,
    availableBalance: 120000,
    averageCostPerCompletion: 18500,
    epaPassRate: 87.5,
    epaAssessedCount: 8,
    yearOnYear: {
      currentPeriod: { label: '2025-08 to 2026-07' },
      priorPeriod: { label: '2024-08 to 2025-07' },
      hasPriorPeriodData: true,
      completionsChangePercent: 14.29,
      startsChangePercent: 10,
    },
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        LevyRoiMonthlyReportService,
        {
          provide: ReportSubscriptionsService,
          useValue: subscriptionsService,
        },
        { provide: LevyRoiReportService, useValue: roiReportService },
        { provide: EmailDispatchService, useValue: emailDispatchService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: string) => {
              // Config keys are dotted paths, so a lookup map rather than an
              // object literal (which the naming-convention rule rejects).
              const values = new Map<string, string>([
                ['app.email.appName', 'Graddly'],
                [
                  'app.frontend.portalUrls.employer',
                  'https://employer.example.com/',
                ],
              ]);
              return values.get(key) ?? fallback;
            }),
          },
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    service = moduleRef.get(LevyRoiMonthlyReportService);
    jest.clearAllMocks();
    roiReportService.getSummary.mockResolvedValue(summary);
    userRepo.findBy.mockResolvedValue([
      { id: 'u-1', firstName: 'Ada', email: 'ada@example.com' },
    ]);
    subscriptionsService.listAllEnabled.mockResolvedValue([]);
  });

  it('does nothing when nobody is subscribed', async () => {
    await expect(service.sendMonthlyReports()).resolves.toBe(0);
    expect(emailDispatchService.enqueue).not.toHaveBeenCalled();
  });

  it('queues one email per subscriber with the report figures', async () => {
    subscriptionsService.listAllEnabled.mockResolvedValue([
      { id: 's-1', organisationId: 'org-1', userId: 'u-1' },
    ]);

    const queued = await service.sendMonthlyReports(
      new Date('2026-08-01T07:00:00Z'),
    );

    expect(queued).toBe(1);
    const enqueued = emailDispatchService.enqueue.mock.calls as [
      SerializedEmailPayload,
    ][];
    const payload = enqueued[0][0];
    expect(payload.template).toBe(EmailTemplate.LEVY_ROI_MONTHLY);
    expect(payload.to).toBe('ada@example.com');
    const context = payload.getTemplateContext();
    expect(context).toMatchObject({
      firstName: 'Ada',
      activeApprenticeCount: 12,
      completionCount: 8,
      epaPassRate: 87.5,
      epaAssessedCount: 8,
      hasPriorPeriodData: true,
      periodLabel: '2025-08 to 2026-07',
    });
    // Trailing slash stripped so the link is not ".com//reports".
    expect(context.reportUrl).toBe('https://employer.example.com/reports');
  });

  it('records when each subscriber was last sent to', async () => {
    subscriptionsService.listAllEnabled.mockResolvedValue([
      { id: 's-1', organisationId: 'org-1', userId: 'u-1' },
    ]);
    const now = new Date('2026-08-01T07:00:00Z');

    await service.sendMonthlyReports(now);

    expect(subscriptionsService.markSent).toHaveBeenCalledWith(['s-1'], now);
  });

  /**
   * The cron runs with no organisation context, so every read would match no
   * rows under RLS. Restored afterwards, or the rest of the process would run
   * with tenant isolation off.
   */
  it('runs the sweep under the RLS bootstrap flag and restores it', async () => {
    await service.sendMonthlyReports();

    expect(setRlsBootstrap).toHaveBeenNthCalledWith(1, true);
    expect(setRlsBootstrap).toHaveBeenNthCalledWith(2, false);
  });

  /**
   * One bad organisation must not stop the sweep. `getSummary` asserts the
   * portal type, so a subscription left on an organisation that changed type
   * throws rather than emailing the wrong report.
   */
  it('skips an organisation whose report cannot be built', async () => {
    subscriptionsService.listAllEnabled.mockResolvedValue([
      { id: 's-1', organisationId: 'org-bad', userId: 'u-1' },
      { id: 's-2', organisationId: 'org-good', userId: 'u-1' },
    ]);
    roiReportService.getSummary
      .mockRejectedValueOnce(new Error('not an employer organisation'))
      .mockResolvedValueOnce(summary);

    const queued = await service.sendMonthlyReports();

    expect(queued).toBe(1);
    expect(setRlsBootstrap).toHaveBeenLastCalledWith(false);
  });

  it('skips a subscriber with no email address', async () => {
    subscriptionsService.listAllEnabled.mockResolvedValue([
      { id: 's-1', organisationId: 'org-1', userId: 'u-1' },
    ]);
    userRepo.findBy.mockResolvedValue([
      { id: 'u-1', firstName: 'Ada', email: null },
    ]);

    await expect(service.sendMonthlyReports()).resolves.toBe(0);
    expect(emailDispatchService.enqueue).not.toHaveBeenCalled();
  });

  /** Null must survive to the template, which says "not yet assessed". */
  it('passes a null EPA pass rate through rather than defaulting to zero', async () => {
    subscriptionsService.listAllEnabled.mockResolvedValue([
      { id: 's-1', organisationId: 'org-1', userId: 'u-1' },
    ]);
    roiReportService.getSummary.mockResolvedValue({
      ...summary,
      epaPassRate: null,
      epaAssessedCount: 0,
      averageCostPerCompletion: null,
      availableBalance: null,
    });

    await service.sendMonthlyReports();

    const enqueued = emailDispatchService.enqueue.mock.calls as [
      SerializedEmailPayload,
    ][];
    const context = enqueued[0][0].getTemplateContext();
    expect(context.epaPassRate).toBeNull();
    expect(context.averageCostPerCompletion).toBeNull();
    expect(context.availableBalance).toBeNull();
  });
});
