import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Apprentice } from '../apprentices/entities/apprentice.entity.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { Standard } from '../programmes/entities/standard.entity.js';
import { TripartiteParty } from '../signing/tripartite-party.enum.js';
import { User } from '../users/entities/user.entity.js';

import { CommitmentBoardService } from './commitment-board.service.js';
import { CommitmentPartyStatus } from './dto/commitment-board-row.dto.js';
import { CommitmentSignature } from './entities/commitment-signature.entity.js';
import { CommitmentStatementGroup } from './entities/commitment-statement-group.entity.js';
import { CommitmentStatement } from './entities/commitment-statement.entity.js';
import { CommitmentSignatureStatus } from './enums/commitment-signature-status.enum.js';
import { CommitmentStatementStatus } from './enums/commitment-statement-status.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

describe('CommitmentBoardService', () => {
  const enrolmentRepo = { find: jest.fn() };
  const groupRepo = {
    find: jest.fn(),
    createQueryBuilder: jest.fn(() => groupQueryBuilder),
  };
  const statementRepo = { find: jest.fn() };
  const signatureRepo = { find: jest.fn() };
  const apprenticeRepo = { find: jest.fn() };
  const organisationRepo = { find: jest.fn() };
  const standardRepo = { find: jest.fn() };
  const userRepo = { find: jest.fn() };
  const groupQueryBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
  };

  let service: CommitmentBoardService;

  const user = {
    id: 'u-1',
    organisationId: 'employer-org',
  } as AuthenticatedUser;

  /** Signing order is provider, employer, apprentice (COMMITMENT_SIGNING_ORDER). */
  const sigs = (
    statementId: string,
    states: Partial<Record<TripartiteParty, CommitmentSignatureStatus>>,
  ) =>
    (
      [
        [TripartiteParty.TUTOR, 1],
        [TripartiteParty.EMPLOYER_MANAGER, 2],
        [TripartiteParty.APPRENTICE, 3],
      ] as const
    )
      .filter(([party]) => states[party] !== undefined)
      .map(([party, signOrder]) => ({
        statementId,
        party,
        signOrder,
        status: states[party],
      }));

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CommitmentBoardService,
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        {
          provide: getRepositoryToken(CommitmentStatementGroup),
          useValue: groupRepo,
        },
        {
          provide: getRepositoryToken(CommitmentStatement),
          useValue: statementRepo,
        },
        {
          provide: getRepositoryToken(CommitmentSignature),
          useValue: signatureRepo,
        },
        { provide: getRepositoryToken(Apprentice), useValue: apprenticeRepo },
        {
          provide: getRepositoryToken(Organisation),
          useValue: organisationRepo,
        },
        { provide: getRepositoryToken(Standard), useValue: standardRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    service = moduleRef.get(CommitmentBoardService);
    jest.clearAllMocks();

    enrolmentRepo.find.mockResolvedValue([
      {
        id: 'enr-1',
        employerOrganisationId: 'employer-org',
        providerOrganisationId: 'prov-1',
        standardId: 'std-1',
        isDeleted: false,
      },
    ]);
    groupRepo.find.mockResolvedValue([
      { id: 'grp-1', enrolmentId: 'enr-1', apprenticeId: 'app-1' },
    ]);
    statementRepo.find.mockResolvedValue([
      {
        id: 'stmt-1',
        groupId: 'grp-1',
        version: 1,
        status: CommitmentStatementStatus.AWAITING_SIGNATURES,
        publishedAt: new Date('2026-07-01T00:00:00Z'),
        finalSignedPdfKey: null,
      },
    ]);
    signatureRepo.find.mockResolvedValue([]);
    apprenticeRepo.find.mockResolvedValue([
      { id: 'app-1', firstName: 'Alex', lastName: 'Okafor' },
    ]);
    organisationRepo.find.mockResolvedValue([
      { id: 'prov-1', name: 'Midlands Training' },
    ]);
    standardRepo.find.mockResolvedValue([
      { id: 'std-1', title: 'Software Developer L4' },
    ]);
  });

  // F1.3.1 AC1 — name, provider, version, and three party statuses.
  describe('columns (AC1)', () => {
    it('resolves apprentice, provider and standard names', async () => {
      const { rows } = await service.getBoard(user);

      expect(rows[0]).toMatchObject({
        apprenticeName: 'Alex Okafor',
        providerName: 'Midlands Training',
        standardName: 'Software Developer L4',
        version: 1,
      });
    });

    it('scopes on the employer link, not the statement owner', async () => {
      // Statements are drafted by the provider, so scoping on
      // statement.organisationId returns nothing for an employer.
      await service.getBoard(user);

      const [options] = enrolmentRepo.find.mock.calls[0] as [
        { where: { employerOrganisationId: string } },
      ];
      expect(options.where.employerOrganisationId).toBe('employer-org');
    });

    it('shows the latest version when a group has several', async () => {
      statementRepo.find.mockResolvedValue([
        { id: 'stmt-2', groupId: 'grp-1', version: 2, status: 'draft' },
        { id: 'stmt-1', groupId: 'grp-1', version: 1, status: 'superseded' },
      ]);

      const { rows } = await service.getBoard(user);

      expect(rows).toHaveLength(1);
      expect(rows[0].version).toBe(2);
    });

    it('returns an empty board when the employer has no enrolments', async () => {
      enrolmentRepo.find.mockResolvedValue([]);

      await expect(service.getBoard(user)).resolves.toEqual({
        rows: [],
        actionRequiredCount: 0,
        total: 0,
      });
    });
  });

  // AC2 — signed / pending / not sent.
  describe('party status (AC2)', () => {
    it('reports "not sent" when no signature row exists', async () => {
      // The enum has only pending and signed; a row appears when the
      // statement is published. Absence is the third state.
      signatureRepo.find.mockResolvedValue([]);

      const { rows } = await service.getBoard(user);

      expect(rows[0].employerStatus).toBe(CommitmentPartyStatus.NOT_SENT);
      expect(rows[0].apprenticeStatus).toBe(CommitmentPartyStatus.NOT_SENT);
      expect(rows[0].providerStatus).toBe(CommitmentPartyStatus.NOT_SENT);
    });

    it('maps each party independently', async () => {
      signatureRepo.find.mockResolvedValue(
        sigs('stmt-1', {
          [TripartiteParty.TUTOR]: CommitmentSignatureStatus.SIGNED,
          [TripartiteParty.EMPLOYER_MANAGER]: CommitmentSignatureStatus.PENDING,
          [TripartiteParty.APPRENTICE]: CommitmentSignatureStatus.PENDING,
        }),
      );

      const { rows } = await service.getBoard(user);

      expect(rows[0].providerStatus).toBe(CommitmentPartyStatus.SIGNED);
      expect(rows[0].employerStatus).toBe(CommitmentPartyStatus.PENDING);
      expect(rows[0].apprenticeStatus).toBe(CommitmentPartyStatus.PENDING);
    });
  });

  // AC3 — highlighted and sorted to the top.
  describe('requires employer signature (AC3)', () => {
    it('flags the row when the provider has signed and the employer is next', async () => {
      signatureRepo.find.mockResolvedValue(
        sigs('stmt-1', {
          [TripartiteParty.TUTOR]: CommitmentSignatureStatus.SIGNED,
          [TripartiteParty.EMPLOYER_MANAGER]: CommitmentSignatureStatus.PENDING,
          [TripartiteParty.APPRENTICE]: CommitmentSignatureStatus.PENDING,
        }),
      );

      const { rows, actionRequiredCount } = await service.getBoard(user);

      expect(rows[0].actionRequired).toBe(true);
      expect(actionRequiredCount).toBe(1);
    });

    it('does not flag it while an earlier party has still to sign', async () => {
      // Signing is sequential — the sign endpoint rejects an out-of-turn
      // attempt, so surfacing this at the top would ask the employer to do
      // something the API refuses.
      signatureRepo.find.mockResolvedValue(
        sigs('stmt-1', {
          [TripartiteParty.TUTOR]: CommitmentSignatureStatus.PENDING,
          [TripartiteParty.EMPLOYER_MANAGER]: CommitmentSignatureStatus.PENDING,
        }),
      );

      const { rows, actionRequiredCount } = await service.getBoard(user);

      expect(rows[0].actionRequired).toBe(false);
      expect(actionRequiredCount).toBe(0);
    });

    it('does not flag it once the employer has signed', async () => {
      signatureRepo.find.mockResolvedValue(
        sigs('stmt-1', {
          [TripartiteParty.TUTOR]: CommitmentSignatureStatus.SIGNED,
          [TripartiteParty.EMPLOYER_MANAGER]: CommitmentSignatureStatus.SIGNED,
          [TripartiteParty.APPRENTICE]: CommitmentSignatureStatus.PENDING,
        }),
      );

      const { rows } = await service.getBoard(user);

      expect(rows[0].actionRequired).toBe(false);
    });

    it('sorts actionable rows above the rest', async () => {
      enrolmentRepo.find.mockResolvedValue([
        {
          id: 'enr-1',
          employerOrganisationId: 'employer-org',
          providerOrganisationId: 'prov-1',
          standardId: 'std-1',
        },
        {
          id: 'enr-2',
          employerOrganisationId: 'employer-org',
          providerOrganisationId: 'prov-1',
          standardId: 'std-1',
        },
      ]);
      groupRepo.find.mockResolvedValue([
        { id: 'grp-1', enrolmentId: 'enr-1', apprenticeId: 'app-1' },
        { id: 'grp-2', enrolmentId: 'enr-2', apprenticeId: 'app-2' },
      ]);
      statementRepo.find.mockResolvedValue([
        // Newer, and not actionable — would sort first on date alone.
        {
          id: 'stmt-2',
          groupId: 'grp-2',
          version: 1,
          status: CommitmentStatementStatus.AWAITING_SIGNATURES,
          publishedAt: new Date('2026-07-20T00:00:00Z'),
        },
        {
          id: 'stmt-1',
          groupId: 'grp-1',
          version: 1,
          status: CommitmentStatementStatus.AWAITING_SIGNATURES,
          publishedAt: new Date('2026-07-01T00:00:00Z'),
        },
      ]);
      signatureRepo.find.mockResolvedValue([
        ...sigs('stmt-1', {
          [TripartiteParty.TUTOR]: CommitmentSignatureStatus.PENDING,
          [TripartiteParty.EMPLOYER_MANAGER]: CommitmentSignatureStatus.PENDING,
        }),
        ...sigs('stmt-2', {
          [TripartiteParty.TUTOR]: CommitmentSignatureStatus.SIGNED,
          [TripartiteParty.EMPLOYER_MANAGER]: CommitmentSignatureStatus.PENDING,
        }),
      ]);
      apprenticeRepo.find.mockResolvedValue([
        { id: 'app-1', firstName: 'Alex', lastName: 'Okafor' },
        { id: 'app-2', firstName: 'Bea', lastName: 'Nkemi' },
      ]);

      const { rows } = await service.getBoard(user);

      expect(rows[0].statementId).toBe('stmt-2');
      expect(rows[0].actionRequired).toBe(true);
      expect(rows[1].actionRequired).toBe(false);
    });
  });

  // AC4 — filter by status, provider and standard.
  describe('filters (AC4)', () => {
    it('filters by statement status', async () => {
      const { rows } = await service.getBoard(user, {
        status: CommitmentStatementStatus.SIGNED,
      });
      expect(rows).toHaveLength(0);
    });

    it('filters by provider', async () => {
      const { rows } = await service.getBoard(user, {
        providerOrganisationId: 'someone-else',
      });
      expect(rows).toHaveLength(0);
    });

    it('filters by standard', async () => {
      const { rows } = await service.getBoard(user, { standardId: 'std-1' });
      expect(rows).toHaveLength(1);
    });
  });

  /**
   * F1.3.2 AC5 — "version history shows all prior versions with dates and
   * signatories".
   */
  describe('version history (F1.3.2 AC5)', () => {
    beforeEach(() => {
      groupQueryBuilder.getOne.mockResolvedValue({
        id: 'grp-1',
        enrolmentId: 'enr-1',
        apprenticeId: 'app-1',
      });
      userRepo.find.mockResolvedValue([
        { id: 'u-tutor', firstName: 'Tia', lastName: 'Tutor', email: 't@x' },
        { id: 'u-mgr', firstName: 'Mo', lastName: 'Manager', email: 'm@x' },
      ]);
    });

    it('returns every version, newest first', async () => {
      statementRepo.find.mockResolvedValue([
        {
          id: 'stmt-2',
          groupId: 'grp-1',
          version: 2,
          status: 'awaiting_signatures',
        },
        { id: 'stmt-1', groupId: 'grp-1', version: 1, status: 'superseded' },
      ]);
      signatureRepo.find.mockResolvedValue([]);

      const { versions } = await service.getVersionHistory(user, 'grp-1');

      expect(versions.map((v) => v.version)).toEqual([2, 1]);
    });

    it('resolves signatory names rather than returning user ids', async () => {
      // "Who signed this, and when" is the whole point of the panel; a UUID
      // answers neither question.
      statementRepo.find.mockResolvedValue([
        { id: 'stmt-1', groupId: 'grp-1', version: 1, status: 'signed' },
      ]);
      signatureRepo.find.mockResolvedValue([
        {
          statementId: 'stmt-1',
          party: TripartiteParty.TUTOR,
          signOrder: 1,
          signerUserId: 'u-tutor',
          status: CommitmentSignatureStatus.SIGNED,
          updatedAt: new Date('2026-07-02T10:00:00Z'),
        },
      ]);

      const { versions } = await service.getVersionHistory(user, 'grp-1');

      expect(versions[0].signatories[0]).toMatchObject({
        party: TripartiteParty.TUTOR,
        name: 'Tia Tutor',
        signed: true,
      });
      expect(versions[0].signatories[0].signedAt).toContain('2026-07-02');
    });

    it('leaves signedAt null while a party is still pending', async () => {
      statementRepo.find.mockResolvedValue([
        {
          id: 'stmt-1',
          groupId: 'grp-1',
          version: 1,
          status: 'awaiting_signatures',
        },
      ]);
      signatureRepo.find.mockResolvedValue([
        {
          statementId: 'stmt-1',
          party: TripartiteParty.EMPLOYER_MANAGER,
          signOrder: 2,
          signerUserId: 'u-mgr',
          status: CommitmentSignatureStatus.PENDING,
          updatedAt: new Date('2026-07-02T10:00:00Z'),
        },
      ]);

      const { versions } = await service.getVersionHistory(user, 'grp-1');

      expect(versions[0].signatories[0].signed).toBe(false);
      expect(versions[0].signatories[0].signedAt).toBeNull();
    });

    it('orders signatories by signing order', async () => {
      statementRepo.find.mockResolvedValue([
        { id: 'stmt-1', groupId: 'grp-1', version: 1, status: 'signed' },
      ]);
      signatureRepo.find.mockResolvedValue([
        {
          statementId: 'stmt-1',
          party: TripartiteParty.EMPLOYER_MANAGER,
          signOrder: 2,
          signerUserId: 'u-mgr',
          status: CommitmentSignatureStatus.SIGNED,
        },
        {
          statementId: 'stmt-1',
          party: TripartiteParty.TUTOR,
          signOrder: 1,
          signerUserId: 'u-tutor',
          status: CommitmentSignatureStatus.SIGNED,
        },
      ]);

      const { versions } = await service.getVersionHistory(user, 'grp-1');

      expect(versions[0].signatories.map((s) => s.party)).toEqual([
        TripartiteParty.TUTOR,
        TripartiteParty.EMPLOYER_MANAGER,
      ]);
    });

    it('404s for an organisation that is not a party', async () => {
      groupQueryBuilder.getOne.mockResolvedValue(null);

      await expect(service.getVersionHistory(user, 'grp-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // AC5 — the sidebar badge.
  describe('action count (AC5)', () => {
    it('counts across the whole board, not the current filter', async () => {
      // A badge that changed when you filtered the table would be measuring
      // the filtered view rather than the work outstanding.
      signatureRepo.find.mockResolvedValue(
        sigs('stmt-1', {
          [TripartiteParty.TUTOR]: CommitmentSignatureStatus.SIGNED,
          [TripartiteParty.EMPLOYER_MANAGER]: CommitmentSignatureStatus.PENDING,
        }),
      );

      const { rows, actionRequiredCount, total } = await service.getBoard(
        user,
        { standardId: 'no-such-standard' },
      );

      expect(rows).toHaveLength(0);
      expect(actionRequiredCount).toBe(1);
      expect(total).toBe(1);
    });
  });
});
