import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { PdfDispatchService } from '../pdf/pdf-dispatch.service.js';
import { StorageKeyBuilder } from '../storage/storage-key.builder.js';
import { User } from '../users/entities/user.entity.js';

import { EifScoreCacheService } from './eif-score-cache.service.js';
import { QipAction } from './entities/qip-action.entity.js';
import { QipActionStatus } from './enums/qip-action-status.enum.js';
import { QipActionsService } from './qip-actions.service.js';

describe('QipActionsService', () => {
  const repo = {
    create: jest.fn((v: unknown) => v),
    save: jest.fn((v: unknown) => Promise.resolve(v)),
    findOne: jest.fn(),
    find: jest.fn(),
    softRemove: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const membershipRepo = { findOne: jest.fn() };
  const keyBuilder = { belongsToOrganisation: jest.fn().mockReturnValue(true) };
  const eifScoreCache = { invalidate: jest.fn() };
  const organisationRepo = { findOne: jest.fn() };
  const userRepo = { findOne: jest.fn(), findBy: jest.fn() };
  const pdfDispatch = { enqueue: jest.fn() };

  let service: QipActionsService;

  const user = {
    id: 'user-1',
    organisationId: 'org-1',
    role: 'owner',
  } as const;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        QipActionsService,
        { provide: getRepositoryToken(QipAction), useValue: repo },
        {
          provide: getRepositoryToken(OrganisationMembership),
          useValue: membershipRepo,
        },
        { provide: StorageKeyBuilder, useValue: keyBuilder },
        { provide: EifScoreCacheService, useValue: eifScoreCache },
        // F2.1.2 AC5 — the plan export names its owners and queues a PDF.
        {
          provide: getRepositoryToken(Organisation),
          useValue: organisationRepo,
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: PdfDispatchService, useValue: pdfDispatch },
      ],
    }).compile();
    service = moduleRef.get(QipActionsService);
    jest.clearAllMocks();
    membershipRepo.findOne.mockResolvedValue({ id: 'm-1' });
  });

  it('rejects invalid EIF criterion slug', async () => {
    await expect(
      service.create(user, {
        title: 'Action',
        assignedOwnerUserId: 'user-1',
        targetCompletionDate: '2026-12-31',
        eifCriterionSlug: 'not_a_real_slug',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('derives overdue when target date passed and not completed', async () => {
    const row = {
      id: 'qip-1',
      organisationId: 'org-1',
      title: 'T',
      description: null,
      assignedOwnerUserId: 'user-1',
      targetCompletionDate: '2020-01-01',
      eifCriterionSlug: 'safeguarding',
      evidenceNotes: null,
      evidenceAttachmentKeys: null,
      status: QipActionStatus.IN_PROGRESS,
    };
    repo.findOne.mockResolvedValue(row);
    const response = await service.findOne(user, 'qip-1');
    expect(response.isOverdue).toBe(true);
  });

  it('invalidates EIF cache on create', async () => {
    await service.create(user, {
      title: 'Action',
      assignedOwnerUserId: 'user-1',
      targetCompletionDate: '2026-12-31',
      eifCriterionSlug: 'safeguarding',
    });
    expect(eifScoreCache.invalidate).toHaveBeenCalledWith('org-1');
  });

  it('returns paginated QIP actions', async () => {
    const getManyAndCount = jest.fn().mockResolvedValue([
      [
        {
          id: 'qip-1',
          organisationId: 'org-1',
          title: 'Action',
          description: null,
          assignedOwnerUserId: 'user-1',
          targetCompletionDate: '2026-12-31',
          eifCriterionSlug: 'safeguarding',
          evidenceNotes: null,
          evidenceAttachmentKeys: null,
          status: QipActionStatus.IN_PROGRESS,
        },
      ],
      1,
    ]);
    repo.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount,
    });

    const result = await service.findAll(user, { page: 1, perPage: 20 });

    expect(result.items).toHaveLength(1);
  });

  it('returns summary counts by status', async () => {
    repo.find.mockResolvedValue([
      {
        status: QipActionStatus.IN_PROGRESS,
        targetCompletionDate: '2026-12-31',
      },
      {
        status: QipActionStatus.COMPLETED,
        targetCompletionDate: '2026-12-31',
      },
    ]);

    const summary = await service.getSummary(user);

    expect(summary.total).toBe(2);
    expect(summary.completed).toBe(1);
  });

  it('updates QIP action', async () => {
    repo.findOne.mockResolvedValue({
      id: 'qip-1',
      organisationId: 'org-1',
      title: 'Old',
      description: null,
      assignedOwnerUserId: 'user-1',
      targetCompletionDate: '2026-12-31',
      eifCriterionSlug: 'safeguarding',
      evidenceNotes: null,
      evidenceAttachmentKeys: null,
      status: QipActionStatus.IN_PROGRESS,
    });
    repo.save.mockImplementation((v: unknown) => Promise.resolve(v));

    const result = await service.update(user, 'qip-1', { title: 'New' });

    expect(result.title).toBe('New');
    expect(eifScoreCache.invalidate).toHaveBeenCalledWith('org-1');
  });

  describe('buildPlanContent (F2.1.2 AC5)', () => {
    const action = (over: Record<string, unknown> = {}) => ({
      id: 'qip-1',
      organisationId: 'org-1',
      title: 'Tighten safeguarding checks',
      description: 'Monthly audit',
      assignedOwnerUserId: 'user-9',
      targetCompletionDate: '2026-12-31',
      eifCriterionSlug: 'safeguarding',
      evidenceNotes: null,
      evidenceAttachmentKeys: null,
      status: QipActionStatus.IN_PROGRESS,
      ...over,
    });

    beforeEach(() => {
      organisationRepo.findOne.mockResolvedValue({ name: 'Northstar' });
      userRepo.findOne.mockResolvedValue({
        firstName: 'Ada',
        lastName: 'Lovelace',
      });
      userRepo.findBy.mockResolvedValue([
        { id: 'user-9', firstName: 'Priya', lastName: 'Shah' },
      ]);
    });

    /**
     * "Assigned owner (staff member)" is the point of AC1, and an inspector
     * cannot chase a UUID.
     */
    it('names the owner rather than printing their id', async () => {
      repo.find.mockResolvedValue([action()]);

      const content = await service.buildPlanContent('org-1', 'user-1');

      expect(content.groups[0].actions[0].ownerName).toBe('Priya Shah');
      expect(content.generatedByName).toBe('Ada Lovelace');
      expect(content.organisationName).toBe('Northstar');
    });

    it('groups by EIF criterion and drops criteria with no actions', async () => {
      repo.find.mockResolvedValue([action()]);

      const content = await service.buildPlanContent('org-1', 'user-1');

      expect(content.groups).toHaveLength(1);
      expect(content.groups[0].slug).toBe('safeguarding');
    });

    it('reports progress and overdue counts', async () => {
      repo.find.mockResolvedValue([
        action({ status: QipActionStatus.COMPLETED }),
        action({ id: 'qip-2', targetCompletionDate: '2020-01-01' }),
      ]);

      const content = await service.buildPlanContent('org-1', 'user-1');

      expect(content.total).toBe(2);
      expect(content.completed).toBe(1);
      expect(content.overdue).toBe(1);
      expect(content.percentComplete).toBe(50);
    });

    it('falls back to Unassigned when the owner cannot be resolved', async () => {
      repo.find.mockResolvedValue([action()]);
      userRepo.findBy.mockResolvedValue([]);

      const content = await service.buildPlanContent('org-1', 'user-1');

      expect(content.groups[0].actions[0].ownerName).toBe('Unassigned');
    });

    it('counts attachments rather than embedding them', async () => {
      repo.find.mockResolvedValue([
        action({ evidenceAttachmentKeys: ['a', 'b'] }),
      ]);

      const content = await service.buildPlanContent('org-1', 'user-1');

      expect(content.groups[0].actions[0].evidenceAttachmentCount).toBe(2);
    });

    it('handles an empty plan without dividing by zero', async () => {
      repo.find.mockResolvedValue([]);

      const content = await service.buildPlanContent('org-1', 'user-1');

      expect(content.total).toBe(0);
      expect(content.percentComplete).toBe(0);
      expect(content.groups).toEqual([]);
    });
  });

  it('soft-removes QIP action', async () => {
    const row = { id: 'qip-1', organisationId: 'org-1' };
    repo.findOne.mockResolvedValue(row);
    repo.softRemove.mockResolvedValue(row);

    await service.remove(user, 'qip-1');

    expect(repo.softRemove).toHaveBeenCalledWith(row);
    expect(eifScoreCache.invalidate).toHaveBeenCalledWith('org-1');
  });
});
