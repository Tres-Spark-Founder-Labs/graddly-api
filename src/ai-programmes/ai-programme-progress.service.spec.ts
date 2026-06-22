import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { ProgrammeDeliveryType } from '../programmes/enums/programme-delivery-type.enum.js';
import { ReportingPortalService } from '../reporting/reporting-portal.service.js';

import { AiProgrammeCatalogueService } from './ai-programme-catalogue.service.js';
import { AiProgrammeProgressService } from './ai-programme-progress.service.js';
import { AiProgrammeCompletion } from './entities/ai-programme-completion.entity.js';
import { AiProgrammeProgress } from './entities/ai-programme-progress.entity.js';
import { AiProgrammeModuleProgressStatus } from './enums/ai-programme-module-progress-status.enum.js';

describe('AiProgrammeProgressService', () => {
  let service: AiProgrammeProgressService;

  const portalService = { assertPortalType: jest.fn() };
  const catalogueService = { loadModulesForProgramme: jest.fn() };
  const enrolmentRepo = { findOne: jest.fn(), save: jest.fn() };
  const progressRepo = { find: jest.fn(), findOne: jest.fn(), save: jest.fn() };
  const completionRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const user = { id: 'user-1', organisationId: 'flow-org' };
  const enrolment = {
    id: 'enrol-1',
    organisationId: 'flow-org',
    status: EnrolmentStatus.ACTIVE,
    standard: {
      programme: {
        id: 'prog-1',
        title: 'AI Dev',
        deliveryType: ProgrammeDeliveryType.FLOWPORTAL_AI,
      },
    },
  } as Enrolment;

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AiProgrammeProgressService,
        { provide: ReportingPortalService, useValue: portalService },
        { provide: AiProgrammeCatalogueService, useValue: catalogueService },
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        {
          provide: getRepositoryToken(AiProgrammeProgress),
          useValue: progressRepo,
        },
        {
          provide: getRepositoryToken(AiProgrammeCompletion),
          useValue: completionRepo,
        },
      ],
    }).compile();

    service = moduleRef.get(AiProgrammeProgressService);
    portalService.assertPortalType.mockResolvedValue({
      portalType: PortalType.FLOW,
    });
    enrolmentRepo.findOne.mockResolvedValue(enrolment);
    catalogueService.loadModulesForProgramme.mockResolvedValue([
      { slug: 'foundations', title: 'Foundations' },
      { slug: 'core-skills', title: 'Core' },
    ]);
  });

  it('calculates percent complete from module statuses', async () => {
    progressRepo.find.mockResolvedValue([
      {
        moduleSlug: 'foundations',
        status: AiProgrammeModuleProgressStatus.COMPLETED,
        completedAt: new Date(),
        metadata: null,
      },
      {
        moduleSlug: 'core-skills',
        status: AiProgrammeModuleProgressStatus.IN_PROGRESS,
        completedAt: null,
        metadata: null,
      },
    ]);

    const result = await service.getProgress(user as never, 'enrol-1');

    expect(result.percentComplete).toBe(50);
    expect(result.modules).toHaveLength(2);
  });

  it('rejects completion when modules remain incomplete', async () => {
    progressRepo.find.mockResolvedValue([
      {
        moduleSlug: 'foundations',
        status: AiProgrammeModuleProgressStatus.COMPLETED,
      },
      {
        moduleSlug: 'core-skills',
        status: AiProgrammeModuleProgressStatus.IN_PROGRESS,
      },
    ]);

    await expect(
      service.completeEnrolment(user as never, 'enrol-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns idempotent completion when enrolment already completed', async () => {
    const completedAt = new Date('2026-06-01T12:00:00.000Z');
    enrolmentRepo.findOne.mockResolvedValue({
      ...enrolment,
      status: EnrolmentStatus.COMPLETED,
      completedAt,
    });
    progressRepo.find.mockResolvedValue([
      {
        moduleSlug: 'foundations',
        status: AiProgrammeModuleProgressStatus.COMPLETED,
      },
      {
        moduleSlug: 'core-skills',
        status: AiProgrammeModuleProgressStatus.COMPLETED,
      },
    ]);
    completionRepo.findOne.mockResolvedValue({
      completedAt,
      summary: { moduleCount: 2 },
    });

    const result = await service.completeEnrolment(user as never, 'enrol-1');

    expect(result.enrolmentStatus).toBe(EnrolmentStatus.COMPLETED);
    expect(enrolmentRepo.save).not.toHaveBeenCalled();
    expect(result.summary).toEqual({ moduleCount: 2 });
  });
});
