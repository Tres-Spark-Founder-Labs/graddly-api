import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { PortalType } from '../organisations/portal-type.enum.js';
import { Programme } from '../programmes/entities/programme.entity.js';
import { ProgrammeDeliveryType } from '../programmes/enums/programme-delivery-type.enum.js';
import { ProgrammeStatus } from '../programmes/enums/programme-status.enum.js';
import { ReportingPortalService } from '../reporting/reporting-portal.service.js';

import { AiProgrammeCatalogueService } from './ai-programme-catalogue.service.js';
import { AiProgrammeModule } from './entities/ai-programme-module.entity.js';

describe('AiProgrammeCatalogueService', () => {
  let service: AiProgrammeCatalogueService;

  const portalService = { assertPortalType: jest.fn() };
  const programmeRepo = { find: jest.fn() };
  const moduleRepo = {
    createQueryBuilder: jest.fn(),
  };

  const queryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    moduleRepo.createQueryBuilder.mockReturnValue(queryBuilder);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AiProgrammeCatalogueService,
        { provide: ReportingPortalService, useValue: portalService },
        { provide: getRepositoryToken(Programme), useValue: programmeRepo },
        {
          provide: getRepositoryToken(AiProgrammeModule),
          useValue: moduleRepo,
        },
      ],
    }).compile();

    service = moduleRef.get(AiProgrammeCatalogueService);
    portalService.assertPortalType.mockResolvedValue({
      portalType: PortalType.FLOW,
    });
  });

  it('requires Flow portal type', async () => {
    portalService.assertPortalType.mockRejectedValue(new ForbiddenException());

    await expect(service.listCatalogue('org-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('lists active flowportal_ai programmes with module counts', async () => {
    const programme = {
      id: 'prog-1',
      code: 'FLOW-AI-DEV',
      title: 'AI Dev',
      description: 'Desc',
      deliveryType: ProgrammeDeliveryType.FLOWPORTAL_AI,
      status: ProgrammeStatus.ACTIVE,
    };
    programmeRepo.find.mockResolvedValue([programme]);
    queryBuilder.getMany.mockResolvedValue([
      { programmeId: 'prog-1', slug: 'a', title: 'A', sortOrder: 1 },
      { programmeId: 'prog-1', slug: 'b', title: 'B', sortOrder: 2 },
    ]);

    const result = await service.listCatalogue('flow-org');

    expect(result).toEqual([
      expect.objectContaining({
        id: 'prog-1',
        deliveryType: ProgrammeDeliveryType.FLOWPORTAL_AI,
        moduleCount: 2,
      }),
    ]);
    expect(programmeRepo.find).toHaveBeenCalled();
    const findCalls = programmeRepo.find.mock.calls as Array<
      [
        {
          where: {
            deliveryType: ProgrammeDeliveryType;
            status: ProgrammeStatus;
          };
        },
      ]
    >;
    expect(findCalls[0][0].where.deliveryType).toBe(
      ProgrammeDeliveryType.FLOWPORTAL_AI,
    );
    expect(findCalls[0][0].where.status).toBe(ProgrammeStatus.ACTIVE);
  });

  it('returns empty catalogue when no programmes', async () => {
    programmeRepo.find.mockResolvedValue([]);

    await expect(service.listCatalogue('flow-org')).resolves.toEqual([]);
    expect(moduleRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('throws when programme detail is not in catalogue', async () => {
    programmeRepo.find.mockResolvedValue([]);

    await expect(
      service.getCatalogueDetail('flow-org', 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
