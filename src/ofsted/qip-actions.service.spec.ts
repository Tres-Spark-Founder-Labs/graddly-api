import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { StorageKeyBuilder } from '../storage/storage-key.builder.js';

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
});
