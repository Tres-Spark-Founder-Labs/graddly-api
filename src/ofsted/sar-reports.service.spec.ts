import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { EpaOutcomeMetricsService } from '../reporting/epa-outcome-metrics.service.js';
import { LearnerOutcomeMetricsService } from '../reporting/learner-outcome-metrics.service.js';
import { User } from '../users/entities/user.entity.js';

import { EifScoreCalculatorService } from './eif-score-calculator.service.js';
import { QipAction } from './entities/qip-action.entity.js';
import { SarReport } from './entities/sar-report.entity.js';
import { QipActionStatus } from './enums/qip-action-status.enum.js';
import { SarReportStatus } from './enums/sar-report-status.enum.js';
import { SarReportsService } from './sar-reports.service.js';
import { SAR_SECTION_TEMPLATES } from './sar-template.config.js';

describe('SarReportsService', () => {
  const repo = {
    create: jest.fn((v: unknown) => v),
    save: jest.fn((v: unknown) => Promise.resolve(v)),
    findOne: jest.fn(),
    find: jest.fn(),
  };
  const qipRepo = { find: jest.fn() };
  const enrolmentRepo = { find: jest.fn() };
  const organisationRepo = { findOne: jest.fn() };
  const userRepo = { findOne: jest.fn() };
  const eifCalculator = { calculate: jest.fn() };
  const outcomeMetrics = {
    reviewComplianceRate: jest.fn(),
    withdrawalRate: jest.fn(),
    countByOutcome: jest.fn(),
  };
  const epaMetrics = { passRateForEnrolments: jest.fn() };

  let service: SarReportsService;

  const user = {
    id: 'user-1',
    organisationId: 'org-1',
    role: 'owner',
  } as const;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        SarReportsService,
        { provide: getRepositoryToken(SarReport), useValue: repo },
        { provide: getRepositoryToken(QipAction), useValue: qipRepo },
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        {
          provide: getRepositoryToken(Organisation),
          useValue: organisationRepo,
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: EifScoreCalculatorService, useValue: eifCalculator },
        { provide: LearnerOutcomeMetricsService, useValue: outcomeMetrics },
        { provide: EpaOutcomeMetricsService, useValue: epaMetrics },
      ],
    }).compile();

    service = moduleRef.get(SarReportsService);
    jest.clearAllMocks();

    repo.findOne.mockResolvedValue(null);
    qipRepo.find.mockResolvedValue([]);
    enrolmentRepo.find.mockResolvedValue([]);
    organisationRepo.findOne.mockResolvedValue({ name: 'Northstar Training' });
    userRepo.findOne.mockResolvedValue({
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    eifCalculator.calculate.mockResolvedValue({
      overallPercent: 72,
      alertBanner: false,
      calculatedAt: '2026-08-01T00:00:00.000Z',
      criteria: [
        {
          slug: 'safeguarding',
          label: 'Safeguarding',
          percent: 90,
          rag: 'green',
        },
        {
          slug: 'personal_development',
          label: 'Personal development',
          percent: 55,
          rag: 'red',
        },
        {
          slug: 'curriculum_impact',
          label: 'Curriculum impact',
          percent: 60,
          rag: 'amber',
        },
      ],
    });
    outcomeMetrics.reviewComplianceRate.mockResolvedValue(88);
    outcomeMetrics.withdrawalRate.mockReturnValue(4.5);
    outcomeMetrics.countByOutcome.mockReturnValue({
      activeCount: 12,
      completedCount: 5,
      withdrawnCount: 1,
    });
    epaMetrics.passRateForEnrolments.mockResolvedValue({
      passRate: 80,
      assessedCount: 5,
    });
  });

  describe('generate (AC1)', () => {
    it('creates every template section', async () => {
      const result = await service.generate(user, { academicYear: '2025-26' });

      expect(result.sections).toHaveLength(SAR_SECTION_TEMPLATES.length);
      expect(result.sections.map((s) => s.key)).toEqual(
        SAR_SECTION_TEMPLATES.map((t) => t.key),
      );
    });

    /** All five AC1 inputs, checked individually rather than as a shape. */
    it('captures all five required data sources', async () => {
      const result = await service.generate(user, { academicYear: '2025-26' });

      expect(result.metrics.eifOverallPercent).toBe(72);
      expect(result.metrics.qip).toBeDefined();
      expect(result.metrics.outcomes.completedCount).toBe(5);
      expect(result.metrics.reviewComplianceRate).toBe(88);
      expect(result.metrics.withdrawalRate).toBe(4.5);
    });

    /**
     * The judgement is the provider's. A platform that pre-filled a grade
     * would be putting words in their mouth that an inspector will hold them
     * to.
     */
    it('never sets a grade', async () => {
      const result = await service.generate(user, { academicYear: '2025-26' });

      expect(result.sections.every((s) => s.grade === null)).toBe(true);
    });

    it('seeds each criterion section with its own score', async () => {
      const result = await service.generate(user, { academicYear: '2025-26' });

      const safeguarding = result.sections.find(
        (s) => s.key === 'safeguarding',
      );
      expect(safeguarding?.narrative).toContain('90%');
    });

    /** Clicking generate twice must not discard what they already wrote. */
    it('returns the existing draft rather than replacing it', async () => {
      repo.findOne.mockResolvedValue({
        id: 'sar-1',
        organisationId: 'org-1',
        academicYear: '2025-26',
        status: SarReportStatus.DRAFT,
        sections: [
          {
            key: 'provider_context',
            heading: 'Provider context',
            narrative: 'Mine',
            grade: null,
          },
        ],
        metrics: {},
        generatedAt: new Date(),
        lockedAt: null,
      });

      const result = await service.generate(user, { academicYear: '2025-26' });

      expect(result.sections[0].narrative).toBe('Mine');
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('handles an organisation with no data at all', async () => {
      outcomeMetrics.reviewComplianceRate.mockResolvedValue(null);
      outcomeMetrics.withdrawalRate.mockReturnValue(null);
      outcomeMetrics.countByOutcome.mockReturnValue({
        activeCount: 0,
        completedCount: 0,
        withdrawnCount: 0,
      });
      epaMetrics.passRateForEnrolments.mockResolvedValue({
        passRate: null,
        assessedCount: 0,
      });

      const result = await service.generate(user, { academicYear: '2025-26' });

      expect(result.metrics.reviewComplianceRate).toBeNull();
      const context = result.sections.find((s) => s.key === 'provider_context');
      // "no rate yet" must not read as 0%, which on a SAR is a confession.
      expect(context?.narrative).toContain('No withdrawal rate');
      expect(context?.narrative).not.toContain('0%');
    });

    it('separates in-flight enrolments from completed ones for EPA', async () => {
      enrolmentRepo.find.mockResolvedValue([
        { id: 'e-1', status: EnrolmentStatus.ACTIVE },
        { id: 'e-2', status: EnrolmentStatus.COMPLETED },
        { id: 'e-3', status: EnrolmentStatus.CANCELLED },
      ]);

      await service.generate(user, { academicYear: '2025-26' });

      // Review compliance: active + completed. EPA: completed only.
      expect(outcomeMetrics.reviewComplianceRate).toHaveBeenCalledWith(
        'org-1',
        ['e-1', 'e-2'],
      );
      expect(epaMetrics.passRateForEnrolments).toHaveBeenCalledWith(['e-2']);
    });

    it('counts overdue QIP actions into the improvement section', async () => {
      qipRepo.find.mockResolvedValue([
        {
          id: 'q-1',
          title: 'Tighten safeguarding checks',
          status: QipActionStatus.IN_PROGRESS,
          targetCompletionDate: '2020-01-01',
        },
        {
          id: 'q-2',
          title: 'Done thing',
          status: QipActionStatus.COMPLETED,
          targetCompletionDate: '2020-01-01',
        },
      ]);

      const result = await service.generate(user, { academicYear: '2025-26' });

      expect(result.metrics.qip).toEqual({
        total: 2,
        completed: 1,
        overdue: 1,
        percentComplete: 50,
      });
      const improvement = result.sections.find(
        (s) => s.key === 'areas_for_improvement',
      );
      expect(improvement?.narrative).toContain('Tighten safeguarding checks');
    });
  });

  describe('update (AC3)', () => {
    const draft = () => ({
      id: 'sar-1',
      organisationId: 'org-1',
      academicYear: '2025-26',
      status: SarReportStatus.DRAFT,
      sections: [
        {
          key: 'safeguarding',
          heading: 'Safeguarding',
          narrative: 'seeded',
          grade: null,
        },
      ],
      metrics: {},
      generatedAt: new Date(),
      lockedAt: null,
    });

    it('edits a narrative and grade', async () => {
      repo.findOne.mockResolvedValue(draft());

      const result = await service.update(user, 'sar-1', {
        sections: [
          { key: 'safeguarding', narrative: 'Ours', grade: 'good' as never },
        ],
      });

      expect(result.sections[0].narrative).toBe('Ours');
      expect(result.sections[0].grade).toBe('good');
    });

    /** The section list is template-owned; a client cannot invent one. */
    it('ignores unknown section keys instead of failing the save', async () => {
      repo.findOne.mockResolvedValue(draft());

      const result = await service.update(user, 'sar-1', {
        sections: [
          { key: 'not_a_section', narrative: 'nope' },
          { key: 'safeguarding', narrative: 'Ours' },
        ],
      });

      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].narrative).toBe('Ours');
    });

    it('leaves untouched sections alone', async () => {
      repo.findOne.mockResolvedValue(draft());

      const result = await service.update(user, 'sar-1', { sections: [] });

      expect(result.sections[0].narrative).toBe('seeded');
    });

    it('refuses to edit a locked report', async () => {
      repo.findOne.mockResolvedValue({
        ...draft(),
        status: SarReportStatus.LOCKED,
      });

      await expect(
        service.update(user, 'sar-1', {
          sections: [{ key: 'safeguarding', narrative: 'x' }],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('404s for another organisation’s report', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.update(user, 'sar-1', { sections: [] }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('lock (AC4)', () => {
    const draft = () => ({
      id: 'sar-1',
      organisationId: 'org-1',
      academicYear: '2025-26',
      status: SarReportStatus.DRAFT,
      sections: [],
      metrics: { eifOverallPercent: 10 },
      generatedAt: new Date(),
      lockedAt: null,
    });

    it('locks and stamps who did it', async () => {
      repo.findOne.mockResolvedValue(draft());

      const result = await service.lock(user, 'sar-1');

      expect(result.status).toBe(SarReportStatus.LOCKED);
      expect(result.lockedAt).not.toBeNull();
      expect(result.editable).toBe(false);
      expect(result.metrics.lockedByName).toBe('Ada Lovelace');
    });

    /**
     * The point of AC4. A SAR written over three weeks is locked against the
     * numbers on the day it is signed off, not the day it was started.
     */
    it('refreshes the figures at lock time rather than reusing generation', async () => {
      repo.findOne.mockResolvedValue(draft());

      const result = await service.lock(user, 'sar-1');

      expect(eifCalculator.calculate).toHaveBeenCalledWith('org-1');
      expect(result.metrics.eifOverallPercent).toBe(72);
    });

    it('cannot lock twice', async () => {
      repo.findOne.mockResolvedValue({
        ...draft(),
        status: SarReportStatus.LOCKED,
      });

      await expect(service.lock(user, 'sar-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
