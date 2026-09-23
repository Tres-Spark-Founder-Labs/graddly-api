import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  getCurrentOrganisationId,
  getRlsBootstrap,
} from '../common/context/correlation-id-context.js';
import { EmailDispatchService } from '../email/email-dispatch.service.js';
import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import {
  NotificationsService,
  type NotificationEmailOutcome,
} from '../notifications/notifications.service.js';
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
  // sendEmail forwards to the dispatcher mock: the gate with every
  // preference on. The gate itself is tested in notifications.service.spec.
  const notificationsService = {
    createForUser: jest.fn(),
    sendEmail: jest.fn(
      async ({
        payload,
      }: {
        payload: unknown;
      }): Promise<NotificationEmailOutcome> => {
        await emailDispatchService.enqueue(payload);
        return 'queued';
      },
    ),
  };
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

  /**
   * F3.4.3 AC3 — the chase email goes through the send-time preference check
   * as a commitment email. When the signer has switched those off, they were
   * still reached in-app, so the chase is recorded: otherwise every run after
   * would post them another in-app notice for an email they asked not to get.
   */
  it('sends the chase as a commitment email through the preference check, and records it when the signer opted out', async () => {
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
    notificationsService.sendEmail.mockResolvedValueOnce('suppressed');

    const sent = await service.sendDueChases();

    expect(notificationsService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        type: NotificationType.COMMITMENT,
      }),
    );
    expect(emailDispatchService.enqueue).not.toHaveBeenCalled();
    expect(sent).toBe(1);
    expect(dispatchRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ signatureId: 'sig-1' }),
    );
  });

  /**
   * The sweep's two contexts: bootstrap for the discovery read, the
   * statement's own organisation for everything after it. Observed from
   * inside each repository call rather than asserted about the source.
   */
  it('discovers under the bootstrap window and acts in each statement own organisation', async () => {
    const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const seen: Record<string, { bootstrap: boolean; org?: string }> = {};
    const record = (key: string) => {
      seen[key] = {
        bootstrap: getRlsBootstrap(),
        org: getCurrentOrganisationId(),
      };
    };

    statementRepo.find.mockImplementation(() => {
      record('statements');
      return Promise.resolve([
        {
          id: 'stmt-1',
          organisationId: 'org-1',
          version: 1,
          status: CommitmentStatementStatus.AWAITING_SIGNATURES,
        },
        {
          id: 'stmt-2',
          organisationId: 'org-2',
          version: 1,
          status: CommitmentStatementStatus.AWAITING_SIGNATURES,
        },
      ]);
    });
    signatureRepo.find.mockImplementation(
      ({ where }: { where: { statementId: string } }) => {
        record(`signatures:${where.statementId}`);
        return Promise.resolve([
          {
            id: `sig-${where.statementId}`,
            statementId: where.statementId,
            signOrder: 1,
            status: CommitmentSignatureStatus.PENDING,
            signerUserId: 'user-1',
            party: TripartiteParty.APPRENTICE,
            createdAt: staleDate,
            updatedAt: staleDate,
          },
        ]);
      },
    );
    dispatchRepo.findOne.mockImplementation(
      ({ where }: { where: { organisationId: string } }) => {
        record(`guard:${where.organisationId}`);
        return Promise.resolve(null);
      },
    );
    dispatchRepo.save.mockImplementation((row: { organisationId: string }) => {
      record(`write:${row.organisationId}`);
      return Promise.resolve(row);
    });
    userRepo.findOne.mockResolvedValue({
      id: 'user-1',
      firstName: 'Alex',
      email: 'alex@example.com',
    });

    const sent = await service.sendDueChases();

    expect(sent).toBe(2);
    // The discovery read, and only it, runs under the window with no tenant.
    expect(seen['statements']).toEqual({ bootstrap: true, org: undefined });
    // Everything after it runs in the statement's organisation.
    expect(seen['signatures:stmt-1']).toEqual({
      bootstrap: false,
      org: 'org-1',
    });
    expect(seen['signatures:stmt-2']).toEqual({
      bootstrap: false,
      org: 'org-2',
    });
    expect(seen['guard:org-1']).toEqual({ bootstrap: false, org: 'org-1' });
    expect(seen['guard:org-2']).toEqual({ bootstrap: false, org: 'org-2' });
    expect(seen['write:org-1']).toEqual({ bootstrap: false, org: 'org-1' });
    expect(seen['write:org-2']).toEqual({ bootstrap: false, org: 'org-2' });
  });

  it('asks the guard for this statement organisation, not for any row with that signature', async () => {
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

    await service.sendDueChases();

    expect(dispatchRepo.findOne).toHaveBeenCalledWith({
      where: {
        organisationId: 'org-1',
        signatureId: 'sig-1',
        chaseKind: CommitmentChaseKind.SEVEN_DAYS,
        isDeleted: false,
      },
    });
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
