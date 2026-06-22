import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { EmailDispatchService } from '../email/email-dispatch.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { TripartiteParty } from '../signing/tripartite-party.enum.js';
import { User } from '../users/entities/user.entity.js';

import { CommitmentChaseService } from './commitment-chase.service.js';
import { CommitmentChaseDispatch } from './entities/commitment-chase-dispatch.entity.js';
import { CommitmentSignature } from './entities/commitment-signature.entity.js';
import { CommitmentStatement } from './entities/commitment-statement.entity.js';
import { CommitmentChaseKind } from './enums/commitment-chase-kind.enum.js';
import { CommitmentSignatureStatus } from './enums/commitment-signature-status.enum.js';
import { CommitmentStatementStatus } from './enums/commitment-statement-status.enum.js';

describe('CommitmentChaseService', () => {
  let service: CommitmentChaseService;

  const statementRepo = { find: jest.fn(), findOne: jest.fn() };
  const signatureRepo = { find: jest.fn(), findOne: jest.fn() };
  const dispatchRepo = {
    findOne: jest.fn(),
    create: jest.fn((value: unknown) => value),
    save: jest.fn(),
  };
  const userRepo = { findOne: jest.fn() };
  const notificationsService = { createForUser: jest.fn() };
  const emailDispatchService = { enqueue: jest.fn() };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CommitmentChaseService,
        {
          provide: getRepositoryToken(CommitmentStatement),
          useValue: statementRepo,
        },
        {
          provide: getRepositoryToken(CommitmentSignature),
          useValue: signatureRepo,
        },
        {
          provide: getRepositoryToken(CommitmentChaseDispatch),
          useValue: dispatchRepo,
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: EmailDispatchService, useValue: emailDispatchService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('Graddly') },
        },
      ],
    }).compile();

    service = moduleRef.get(CommitmentChaseService);
    jest.clearAllMocks();
  });

  it('sends chase when pending signature is older than 7 days', async () => {
    const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    statementRepo.find.mockResolvedValue([
      {
        id: 'stmt-1',
        organisationId: 'org-1',
        version: 1,
        status: CommitmentStatementStatus.AWAITING_SIGNATURES,
      },
    ]);
    signatureRepo.find.mockResolvedValue([
      {
        id: 'sig-1',
        statementId: 'stmt-1',
        signOrder: 1,
        status: CommitmentSignatureStatus.PENDING,
        signerUserId: 'user-1',
        party: TripartiteParty.APPRENTICE,
        createdAt: staleDate,
        updatedAt: staleDate,
      },
    ]);
    dispatchRepo.findOne.mockResolvedValue(null);
    userRepo.findOne.mockResolvedValue({
      id: 'user-1',
      firstName: 'Alex',
      email: 'alex@example.com',
    });

    const sent = await service.sendDueChases();

    expect(sent).toBe(1);
    expect(notificationsService.createForUser).toHaveBeenCalled();
    expect(emailDispatchService.enqueue).toHaveBeenCalled();
    expect(dispatchRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        signatureId: 'sig-1',
        chaseKind: CommitmentChaseKind.SEVEN_DAYS,
      }),
    );
  });

  it('skips when dispatch already exists', async () => {
    const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    statementRepo.find.mockResolvedValue([
      {
        id: 'stmt-1',
        organisationId: 'org-1',
        version: 1,
        status: CommitmentStatementStatus.AWAITING_SIGNATURES,
      },
    ]);
    signatureRepo.find.mockResolvedValue([
      {
        id: 'sig-1',
        signOrder: 1,
        status: CommitmentSignatureStatus.PENDING,
        signerUserId: 'user-1',
        party: TripartiteParty.APPRENTICE,
        createdAt: staleDate,
        updatedAt: staleDate,
      },
    ]);
    dispatchRepo.findOne.mockResolvedValue({ id: 'dispatch-1' });

    const sent = await service.sendDueChases();
    expect(sent).toBe(0);
    expect(notificationsService.createForUser).not.toHaveBeenCalled();
  });
});
