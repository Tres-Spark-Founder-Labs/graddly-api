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

  describe('assertPortalTypeIn', () => {
    it('admits an organisation matching any of the expected types', async () => {
      const organisation = {
        id: 'org-1',
        portalType: PortalType.EMPLOYER,
        isDeleted: false,
      };
      findOne.mockResolvedValue(organisation);

      await expect(
        service.assertPortalTypeIn('org-1', [
          PortalType.PROVIDER,
          PortalType.EMPLOYER,
        ]),
      ).resolves.toEqual(organisation);
    });

    it('refuses an organisation matching none of them', async () => {
      findOne.mockResolvedValue({
        id: 'org-1',
        portalType: PortalType.FLOW,
        isDeleted: false,
      });

      await expect(
        service.assertPortalTypeIn('org-1', [
          PortalType.PROVIDER,
          PortalType.EMPLOYER,
        ]),
      ).rejects.toThrow(
        'This endpoint requires an active provider or employer portal organisation',
      );
    });

    it('refuses an organisation with no portal type at all', async () => {
      // A null is not one of the expected types. Reading it as "matches
      // anything" would hand an unconfigured organisation every portal.
      findOne.mockResolvedValue({
        id: 'org-1',
        portalType: null,
        isDeleted: false,
      });

      await expect(
        service.assertPortalTypeIn('org-1', [PortalType.PROVIDER]),
      ).rejects.toThrow(ForbiddenException);
    });

    it('keeps the single-type wording that existing clients match on', async () => {
      findOne.mockResolvedValue({
        id: 'org-1',
        portalType: PortalType.PROVIDER,
        isDeleted: false,
      });

      await expect(
        service.assertPortalTypeIn('org-1', [PortalType.EMPLOYER]),
      ).rejects.toThrow(
        'This endpoint requires an active employer portal organisation',
      );
    });
  });
});
