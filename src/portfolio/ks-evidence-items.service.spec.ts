import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { NotificationsService } from '../notifications/notifications.service.js';
import { EifScoreCacheService } from '../ofsted/eif-score-cache.service.js';
import { OrganisationRole } from '../organisations/organisation-role.enum.js';
import { StorageService } from '../storage/storage.service.js';

import { KsEvidenceItem } from './entities/ks-evidence-item.entity.js';
import { KsEvidenceKsbMapping } from './entities/ks-evidence-ksb-mapping.entity.js';
import { KsEvidenceStatus } from './enums/ks-evidence-status.enum.js';
import { KsEvidenceType } from './enums/ks-evidence-type.enum.js';
import { KsEvidenceItemsService } from './ks-evidence-items.service.js';
import { KsEvidenceStatusService } from './ks-evidence-status.service.js';
import { KsEvidenceStorageService } from './ks-evidence-storage.service.js';
import { KsbDefinitionsService } from './ksb-definitions.service.js';
import { PortfolioEnrolmentContext } from './portfolio-enrolment.context.js';
import { PortfolioHeatmapCacheService } from './portfolio-heatmap-cache.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import { staffLearnerScopeProvider } from '../../test/mocks/learner-scope.mock.js';

const apprenticeUser = {
  id: 'user-1',
  organisationId: 'org-1',
  roles: [],
} as AuthenticatedUser;

const adminUser = {
  id: 'admin-1',
  organisationId: 'org-1',
  roles: [OrganisationRole.ADMIN],
} as AuthenticatedUser;

describe('KsEvidenceItemsService', () => {
  const itemFindOne = jest.fn();
  const itemSave = jest.fn();
  const itemRepo = {
    findOne: itemFindOne,
    save: itemSave,
    createQueryBuilder: jest.fn(),
  };
  const mappingFind = jest.fn();
  const mappingRepo = { find: mappingFind };
  const transaction = jest.fn();
  const dataSource = { transaction };
  const enrolmentContext = {
    requireEnrolment: jest.fn(),
    // Defaults to allowed, so these specs keep asserting what their names say.
    // The refusal path is covered end-to-end in
    // `test/learner-scope-surface.e2e-spec.ts`, where a real learner principal
    // exists to be refused — a boolean stub here would only be testing itself.
    canAccessEnrolment: jest.fn().mockReturnValue(true),
  };
  const ksbDefinitionsService = {
    findEntitiesForStandard: jest.fn(),
    findResponsesByIds: jest.fn(),
  };
  const storageService = { createUploadUrl: jest.fn() };
  const evidenceStorage = { assertEvidenceStorageKey: jest.fn() };
  const statusService = {
    applyTransition: jest.fn(),
    canReturnToDraft: jest.fn(),
  };
  const notificationsService = { createForUser: jest.fn() };
  const heatmapCache = { invalidate: jest.fn() };
  const eifScoreCache = { invalidate: jest.fn() };

  let service: KsEvidenceItemsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    enrolmentContext.requireEnrolment.mockResolvedValue({
      id: 'enr-1',
      standardId: 'std-1',
    });
    ksbDefinitionsService.findEntitiesForStandard.mockResolvedValue([]);
    ksbDefinitionsService.findResponsesByIds.mockResolvedValue([]);
    mappingFind.mockResolvedValue([]);
    statusService.canReturnToDraft.mockReturnValue(true);

    const moduleRef = await Test.createTestingModule({
      providers: [
        staffLearnerScopeProvider(),
        KsEvidenceItemsService,
        {
          provide: getRepositoryToken(KsEvidenceItem),
          useValue: itemRepo,
        },
        {
          provide: getRepositoryToken(KsEvidenceKsbMapping),
          useValue: mappingRepo,
        },
        { provide: DataSource, useValue: dataSource },
        { provide: PortfolioEnrolmentContext, useValue: enrolmentContext },
        { provide: KsbDefinitionsService, useValue: ksbDefinitionsService },
        { provide: StorageService, useValue: storageService },
        { provide: KsEvidenceStorageService, useValue: evidenceStorage },
        { provide: KsEvidenceStatusService, useValue: statusService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: PortfolioHeatmapCacheService, useValue: heatmapCache },
        { provide: EifScoreCacheService, useValue: eifScoreCache },
      ],
    }).compile();

    service = moduleRef.get(KsEvidenceItemsService);
  });

  describe('createUploadUrl', () => {
    it('delegates to storage service', async () => {
      storageService.createUploadUrl.mockResolvedValue({
        uploadUrl: 'https://upload.example.com',
        key: 'key-1',
      });

      const result = await service.createUploadUrl(apprenticeUser, {
        filename: 'file.pdf',
        contentType: 'application/pdf',
        contentLength: 1000,
        apprenticeId: 'app-1',
      });

      expect(storageService.createUploadUrl).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({
          filename: 'file.pdf',
          learnerId: 'app-1',
        }),
      );
      expect(result.uploadUrl).toBe('https://upload.example.com');
    });
  });

  describe('create', () => {
    it('creates text evidence in a transaction', async () => {
      const persisted = {
        id: 'ev-1',
        organisationId: 'org-1',
        enrolmentId: 'enr-1',
        apprenticeId: 'app-1',
        type: KsEvidenceType.TEXT,
        title: 'Note',
        body: 'Evidence body',
        storageKey: null,
        externalUrl: null,
        status: KsEvidenceStatus.DRAFT,
      };
      transaction.mockImplementation((fn: (manager: unknown) => unknown) =>
        fn({
          create: jest
            .fn()
            .mockImplementation((_entity: unknown, value: unknown) => value),
          save: jest
            .fn()
            .mockImplementation((value: unknown) =>
              Array.isArray(value) ? value : persisted,
            ),
        }),
      );

      const result = await service.create(apprenticeUser, {
        enrolmentId: 'enr-1',
        apprenticeId: 'app-1',
        type: KsEvidenceType.TEXT,
        title: 'Note',
        body: 'Evidence body',
        ksbDefinitionIds: ['ksb-1'],
      });

      expect(result.id).toBe('ev-1');
      expect(result.status).toBe(KsEvidenceStatus.DRAFT);
    });

    it('rejects file evidence without storageKey', async () => {
      await expect(
        service.create(apprenticeUser, {
          enrolmentId: 'enr-1',
          apprenticeId: 'app-1',
          type: KsEvidenceType.FILE,
          title: 'File',
          ksbDefinitionIds: ['ksb-1'],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('returns paginated evidence items', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([
          [
            {
              id: 'ev-1',
              organisationId: 'org-1',
              enrolmentId: 'enr-1',
              apprenticeId: 'app-1',
              type: KsEvidenceType.TEXT,
              title: 'Note',
              body: 'body',
              storageKey: null,
              externalUrl: null,
              status: KsEvidenceStatus.DRAFT,
              submittedAt: null,
              reviewedAt: null,
              acceptedAt: null,
              returnReason: null,
            },
          ],
          1,
        ]),
      };
      itemRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findAll(apprenticeUser, {});

      expect(result.items).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });
  });

  describe('findOne', () => {
    it('returns a single evidence item', async () => {
      itemFindOne.mockResolvedValue({
        id: 'ev-1',
        organisationId: 'org-1',
        enrolmentId: 'enr-1',
        apprenticeId: 'app-1',
        type: KsEvidenceType.TEXT,
        title: 'Note',
        body: 'body',
        storageKey: null,
        externalUrl: null,
        status: KsEvidenceStatus.DRAFT,
        submittedAt: null,
        reviewedAt: null,
        acceptedAt: null,
        returnReason: null,
      });

      const result = await service.findOne(apprenticeUser, 'ev-1');

      expect(result.id).toBe('ev-1');
    });
  });

  describe('update', () => {
    it('updates draft evidence', async () => {
      const row = {
        id: 'ev-1',
        organisationId: 'org-1',
        enrolmentId: 'enr-1',
        apprenticeId: 'app-1',
        type: KsEvidenceType.TEXT,
        title: 'Old',
        body: 'body',
        status: KsEvidenceStatus.DRAFT,
      };
      itemFindOne.mockResolvedValue(row);
      itemSave.mockResolvedValue(row);

      const result = await service.update(apprenticeUser, 'ev-1', {
        title: 'New',
      });

      expect(result.title).toBe('New');
      expect(itemSave).toHaveBeenCalled();
    });

    it('rejects updates to non-draft evidence', async () => {
      itemFindOne.mockResolvedValue({
        id: 'ev-1',
        status: KsEvidenceStatus.SUBMITTED,
      });

      await expect(
        service.update(apprenticeUser, 'ev-1', { title: 'New' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('submit', () => {
    it('submits draft evidence and invalidates heatmap cache', async () => {
      const row = {
        id: 'ev-1',
        organisationId: 'org-1',
        enrolmentId: 'enr-1',
        apprenticeId: 'app-1',
        type: KsEvidenceType.TEXT,
        title: 'Note',
        body: 'body',
        storageKey: null,
        externalUrl: null,
        status: KsEvidenceStatus.DRAFT,
        submittedAt: null,
        reviewedAt: null,
        acceptedAt: null,
        returnReason: null,
      };
      itemFindOne.mockResolvedValue(row);
      itemSave.mockResolvedValue({
        ...row,
        status: KsEvidenceStatus.SUBMITTED,
      });

      const result = await service.submit(apprenticeUser, 'ev-1');

      expect(statusService.applyTransition).toHaveBeenCalledWith(
        KsEvidenceStatus.DRAFT,
        KsEvidenceStatus.SUBMITTED,
      );
      expect(heatmapCache.invalidate).toHaveBeenCalledWith('org-1', 'enr-1');
      expect(result.status).toBe(KsEvidenceStatus.SUBMITTED);
    });
  });

  describe('review', () => {
    it('requires admin role', async () => {
      itemFindOne.mockResolvedValue({
        id: 'ev-1',
        status: KsEvidenceStatus.SUBMITTED,
      });

      await expect(service.review(apprenticeUser, 'ev-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('reviews submitted evidence as admin', async () => {
      const row = {
        id: 'ev-1',
        organisationId: 'org-1',
        enrolmentId: 'enr-1',
        apprenticeId: 'app-1',
        type: KsEvidenceType.TEXT,
        title: 'Note',
        body: 'body',
        storageKey: null,
        externalUrl: null,
        status: KsEvidenceStatus.SUBMITTED,
        submittedAt: new Date(),
        reviewedAt: null,
        acceptedAt: null,
        returnReason: null,
      };
      itemFindOne.mockResolvedValue(row);
      itemSave.mockResolvedValue({ ...row, status: KsEvidenceStatus.REVIEWED });

      const result = await service.review(adminUser, 'ev-1');

      expect(result.status).toBe(KsEvidenceStatus.REVIEWED);
      expect(heatmapCache.invalidate).toHaveBeenCalled();
    });
  });

  describe('accept', () => {
    it('accepts reviewed evidence and notifies submitter', async () => {
      const row = {
        id: 'ev-1',
        organisationId: 'org-1',
        enrolmentId: 'enr-1',
        apprenticeId: 'app-1',
        type: KsEvidenceType.TEXT,
        title: 'Note',
        body: 'body',
        storageKey: null,
        externalUrl: null,
        status: KsEvidenceStatus.REVIEWED,
        submittedByUserId: 'user-1',
        submittedAt: new Date(),
        reviewedAt: new Date(),
        acceptedAt: null,
        returnReason: null,
      };
      itemFindOne.mockResolvedValue(row);
      itemSave.mockResolvedValue({ ...row, status: KsEvidenceStatus.ACCEPTED });

      const result = await service.accept(adminUser, 'ev-1');

      expect(result.status).toBe(KsEvidenceStatus.ACCEPTED);
      expect(eifScoreCache.invalidate).toHaveBeenCalledWith('org-1');
      expect(notificationsService.createForUser).toHaveBeenCalled();
    });
  });

  describe('returnToDraft', () => {
    it('returns submitted evidence to draft', async () => {
      const row = {
        id: 'ev-1',
        organisationId: 'org-1',
        enrolmentId: 'enr-1',
        apprenticeId: 'app-1',
        type: KsEvidenceType.TEXT,
        title: 'Note',
        body: 'body',
        storageKey: null,
        externalUrl: null,
        status: KsEvidenceStatus.SUBMITTED,
        submittedAt: new Date(),
        reviewedAt: null,
        acceptedAt: null,
        returnReason: null,
      };
      itemFindOne.mockResolvedValue(row);
      itemSave.mockResolvedValue({ ...row, status: KsEvidenceStatus.DRAFT });

      const result = await service.returnToDraft(
        adminUser,
        'ev-1',
        'Needs changes',
      );

      expect(result.status).toBe(KsEvidenceStatus.DRAFT);
      expect(heatmapCache.invalidate).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('soft-deletes draft evidence', async () => {
      const row = {
        id: 'ev-1',
        status: KsEvidenceStatus.DRAFT,
        isDeleted: false,
      };
      itemFindOne.mockResolvedValue(row);
      itemSave.mockResolvedValue(row);

      await service.remove(apprenticeUser, 'ev-1');

      expect(row.isDeleted).toBe(true);
      expect(row.deletedAt).toEqual(expect.any(Date));
      expect(itemSave).toHaveBeenCalledWith(row);
    });

    it('rejects deletion of non-draft evidence', async () => {
      itemFindOne.mockResolvedValue({
        id: 'ev-1',
        status: KsEvidenceStatus.SUBMITTED,
      });

      await expect(service.remove(apprenticeUser, 'ev-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findEntity', () => {
    it('throws when evidence is not found', async () => {
      itemFindOne.mockResolvedValue(null);

      await expect(
        service.findEntity(apprenticeUser, 'missing'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
