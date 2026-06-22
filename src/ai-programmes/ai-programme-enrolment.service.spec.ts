import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ApprenticesService } from '../apprentices/apprentices.service.js';
import { EnrolmentsService } from '../enrolments/enrolments.service.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { Programme } from '../programmes/entities/programme.entity.js';
import { Standard } from '../programmes/entities/standard.entity.js';
import { ProgrammeDeliveryType } from '../programmes/enums/programme-delivery-type.enum.js';
import { StandardStatus } from '../programmes/enums/standard-status.enum.js';
import { ReportingPortalService } from '../reporting/reporting-portal.service.js';

import { AiProgrammeCatalogueService } from './ai-programme-catalogue.service.js';
import { AiProgrammeEnrolmentService } from './ai-programme-enrolment.service.js';
import { AiProgrammeProgress } from './entities/ai-programme-progress.entity.js';
import { AiProgrammeModuleProgressStatus } from './enums/ai-programme-module-progress-status.enum.js';

describe('AiProgrammeEnrolmentService', () => {
  let service: AiProgrammeEnrolmentService;

  const portalService = { assertPortalType: jest.fn() };
  const catalogueService = {
    loadAiProgrammeById: jest.fn(),
    loadModulesForProgramme: jest.fn(),
  };
  const apprenticesService = {
    findOne: jest.fn(),
    create: jest.fn(),
  };
  const enrolmentsService = { activate: jest.fn() };
  const enrolmentRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
  const standardRepo = { findOne: jest.fn() };
  const progressRepo = {
    create: jest.fn(),
    save: jest.fn(),
  };

  const user = { id: 'user-1', organisationId: 'flow-org' };
  const programme = {
    id: 'prog-1',
    organisationId: 'provider-org',
    deliveryType: ProgrammeDeliveryType.FLOWPORTAL_AI,
  } as Programme;

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AiProgrammeEnrolmentService,
        { provide: ReportingPortalService, useValue: portalService },
        { provide: AiProgrammeCatalogueService, useValue: catalogueService },
        { provide: ApprenticesService, useValue: apprenticesService },
        { provide: EnrolmentsService, useValue: enrolmentsService },
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        { provide: getRepositoryToken(Standard), useValue: standardRepo },
        {
          provide: getRepositoryToken(AiProgrammeProgress),
          useValue: progressRepo,
        },
      ],
    }).compile();

    service = moduleRef.get(AiProgrammeEnrolmentService);
    portalService.assertPortalType.mockResolvedValue({
      portalType: PortalType.FLOW,
    });
    catalogueService.loadAiProgrammeById.mockResolvedValue(programme);
    standardRepo.findOne.mockResolvedValue({
      id: 'std-1',
      programmeId: 'prog-1',
      status: StandardStatus.ACTIVE,
    });
    apprenticesService.findOne.mockResolvedValue({ id: 'app-1' });
    enrolmentRepo.findOne.mockResolvedValue(null);
    enrolmentRepo.create.mockImplementation((row: Enrolment) => row);
    enrolmentRepo.save.mockImplementation((row: Enrolment) =>
      Promise.resolve({ ...row, id: 'enrol-1' }),
    );
    catalogueService.loadModulesForProgramme.mockResolvedValue([
      { slug: 'foundations' },
      { slug: 'core-skills' },
    ]);
    progressRepo.create.mockImplementation((row: AiProgrammeProgress) => row);
    progressRepo.save.mockResolvedValue([]);
    enrolmentsService.activate.mockResolvedValue({
      id: 'enrol-1',
      status: EnrolmentStatus.ACTIVE,
    });
  });

  it('rejects when programme is not in AI catalogue', async () => {
    catalogueService.loadAiProgrammeById.mockResolvedValue(null);

    await expect(
      service.createEnrolment(user as never, {
        programmeId: 'missing',
        apprenticeId: 'app-1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects duplicate active enrolment', async () => {
    enrolmentRepo.findOne.mockResolvedValue({
      status: EnrolmentStatus.ACTIVE,
      isDeleted: false,
    });

    await expect(
      service.createEnrolment(user as never, {
        programmeId: 'prog-1',
        apprenticeId: 'app-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('initializes progress rows and activates enrolment', async () => {
    const result = await service.createEnrolment(user as never, {
      programmeId: 'prog-1',
      apprenticeId: 'app-1',
    });

    expect(progressRepo.save).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          moduleSlug: 'foundations',
          status: AiProgrammeModuleProgressStatus.NOT_STARTED,
        }),
        expect.objectContaining({ moduleSlug: 'core-skills' }),
      ]),
    );
    expect(enrolmentsService.activate).toHaveBeenCalledWith(user, 'enrol-1');
    expect(result).toEqual(
      expect.objectContaining({
        enrolmentId: 'enrol-1',
        progressModuleCount: 2,
        providerOrganisationId: 'provider-org',
      }),
    );
  });
});
