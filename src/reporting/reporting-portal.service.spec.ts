import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Organisation } from '../organisations/entities/organisation.entity.js';
import { PortalType } from '../organisations/portal-type.enum.js';

import { ReportingPortalService } from './reporting-portal.service.js';

describe('ReportingPortalService', () => {
  const findOne = jest.fn();
  const organisationRepo = { findOne };

  let service: ReportingPortalService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReportingPortalService,
        {
          provide: getRepositoryToken(Organisation),
          useValue: organisationRepo,
        },
      ],
    }).compile();
    service = moduleRef.get(ReportingPortalService);
  });

  describe('assertPortalType', () => {
    it('returns the organisation when portal type matches', async () => {
      const organisation = {
        id: 'org-1',
        portalType: PortalType.EMPLOYER,
        isDeleted: false,
      };
      findOne.mockResolvedValue(organisation);

      await expect(
        service.assertPortalType('org-1', PortalType.EMPLOYER),
      ).resolves.toEqual(organisation);
    });

    it('throws when organisation is not found', async () => {
      findOne.mockResolvedValue(null);

      await expect(
        service.assertPortalType('missing', PortalType.EMPLOYER),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws when portal type does not match', async () => {
      findOne.mockResolvedValue({
        id: 'org-1',
        portalType: PortalType.PROVIDER,
        isDeleted: false,
      });

      await expect(
        service.assertPortalType('org-1', PortalType.EMPLOYER),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
