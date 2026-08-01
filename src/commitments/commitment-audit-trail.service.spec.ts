import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AuditLogEntry } from '../audit/entities/audit-log-entry.entity.js';
import { AuditAction } from '../audit/enums/audit-action.enum.js';
import { setRlsBootstrap } from '../common/context/correlation-id-context.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { PdfDispatchService } from '../pdf/pdf-dispatch.service.js';
import { User } from '../users/entities/user.entity.js';

import {
  CommitmentAuditTrailService,
  summariseChanges,
} from './commitment-audit-trail.service.js';
import { CommitmentStatementsService } from './commitment-statements.service.js';
import { CommitmentSignature } from './entities/commitment-signature.entity.js';
import { CommitmentStatementGroup } from './entities/commitment-statement-group.entity.js';
import { CommitmentStatement } from './entities/commitment-statement.entity.js';

jest.mock('../common/context/correlation-id-context.js', () => ({
  getRlsBootstrap: jest.fn(() => false),
  setRlsBootstrap: jest.fn(),
}));

const EMPLOYER_ORG = 'org-employer';
const PROVIDER_ORG = 'org-provider';

describe('summariseChanges (F1.3.3 AC3)', () => {
  it('reads a diff as prose rather than JSON', () => {
    expect(
      summariseChanges({ status: { from: 'draft', to: 'published' } }),
    ).toBe('status: draft → published');
  });

  it('handles insert-only and delete-only shapes', () => {
    expect(summariseChanges({ version: { to: 2 } })).toBe('version: 2');
    expect(summariseChanges({ note: { from: 'old' } })).toBe('note: was old');
  });

  it('says "empty" rather than printing null or a blank', () => {
    expect(summariseChanges({ note: { from: null, to: '' } })).toBe(
      'note: empty → empty',
    );
  });

  it('returns null when there is nothing to say', () => {
    expect(summariseChanges(null)).toBeNull();
    expect(summariseChanges({})).toBeNull();
  });

  it('truncates a pathological blob rather than producing a 40-page entry', () => {
    const summary = summariseChanges({
      content: { from: 'x'.repeat(500), to: 'y'.repeat(500) },
    });
    expect(summary).not.toBeNull();
    expect(summary!.length).toBe(300);
    expect(summary!.endsWith('...')).toBe(true);
  });
});

describe('CommitmentAuditTrailService', () => {
  const statementRepo = { findOne: jest.fn(), find: jest.fn() };
  const groupRepo = { findOne: jest.fn() };
  const signatureRepo = { find: jest.fn() };
  const auditRepo = { find: jest.fn() };
  const enrolmentRepo = { findOne: jest.fn() };
  const organisationRepo = { findOne: jest.fn() };
  const userRepo = { findOne: jest.fn() };
  const pdfDispatch = { enqueue: jest.fn() };
  const findStatementAsParty = jest.fn();

  let service: CommitmentAuditTrailService;

  const statement = {
    id: 'stmt-2',
    groupId: 'group-1',
    organisationId: PROVIDER_ORG,
    version: 2,
    status: 'signed',
    createdAt: new Date('2026-03-01T09:00:00Z'),
    supersededAt: null,
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CommitmentAuditTrailService,
        {
          provide: getRepositoryToken(CommitmentStatement),
          useValue: statementRepo,
        },
        {
          provide: getRepositoryToken(CommitmentStatementGroup),
          useValue: groupRepo,
        },
        {
          provide: getRepositoryToken(CommitmentSignature),
          useValue: signatureRepo,
        },
        { provide: getRepositoryToken(AuditLogEntry), useValue: auditRepo },
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        {
          provide: getRepositoryToken(Organisation),
          useValue: organisationRepo,
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: PdfDispatchService, useValue: pdfDispatch },
        {
          provide: CommitmentStatementsService,
          useValue: { findStatementAsParty },
        },
      ],
    }).compile();

    service = moduleRef.get(CommitmentAuditTrailService);
    jest.clearAllMocks();

    statementRepo.findOne.mockResolvedValue({ ...statement });
    statementRepo.find.mockResolvedValue([
      {
        ...statement,
        id: 'stmt-1',
        version: 1,
        status: 'superseded',
        createdAt: new Date('2026-01-01T09:00:00Z'),
        supersededAt: new Date('2026-03-01T09:00:00Z'),
      },
      { ...statement },
    ]);
    groupRepo.findOne.mockResolvedValue({
      id: 'group-1',
      enrolmentId: 'enr-1',
      currentVersionId: 'stmt-2',
      apprentice: { firstName: 'Amara', lastName: 'Diallo' },
    });
    enrolmentRepo.findOne.mockResolvedValue({
      id: 'enr-1',
      employerOrganisationId: EMPLOYER_ORG,
      providerOrganisationId: PROVIDER_ORG,
    });
    signatureRepo.find.mockResolvedValue([{ id: 'sig-1' }, { id: 'sig-2' }]);
    auditRepo.find.mockResolvedValue([]);
    organisationRepo.findOne.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve({
          id: where.id,
          name: where.id === EMPLOYER_ORG ? 'Midlands Eng' : 'Skillsmith',
        }),
    );
    userRepo.findOne.mockResolvedValue({
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
  });

  const employerUser = {
    id: 'user-1',
    organisationId: EMPLOYER_ORG,
  } as never;

  /**
   * The trap this whole feature walks into: audit entries carry the *statement
   * owner's* organisationId, and the statement is drafted by the provider. An
   * employer-scoped read returns nothing.
   */
  it('gathers entries for the group, every version and every signature', async () => {
    await service.buildPdfContent({
      organisationId: EMPLOYER_ORG,
      statementId: 'stmt-2',
      requestedByUserId: 'user-1',
    });

    const calls = auditRepo.find.mock.calls as [
      { where: { entityId: { _value: string[] } } },
    ][];
    expect(calls[0][0].where.entityId._value).toEqual([
      'group-1',
      'stmt-1',
      'stmt-2',
      'sig-1',
      'sig-2',
    ]);
  });

  it('reads under the RLS bootstrap flag and restores it', async () => {
    await service.buildPdfContent({
      organisationId: EMPLOYER_ORG,
      statementId: 'stmt-2',
      requestedByUserId: 'user-1',
    });

    expect(setRlsBootstrap).toHaveBeenNthCalledWith(1, true);
    expect(setRlsBootstrap).toHaveBeenNthCalledWith(2, false);
  });

  it('refuses an organisation that is not a party', async () => {
    await expect(
      service.buildPdfContent({
        organisationId: 'org-stranger',
        statementId: 'stmt-2',
        requestedByUserId: 'user-1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // ...and never lifts RLS for them.
    expect(setRlsBootstrap).not.toHaveBeenCalled();
  });

  it('renders entries oldest-first with actor, description and diff', async () => {
    auditRepo.find.mockResolvedValue([
      {
        createdAt: new Date('2026-03-01T09:00:00Z'),
        actorName: 'Priya Shah',
        actorRole: 'admin',
        action: AuditAction.SIGN,
        entityType: 'commitment_statements',
        description: 'Signed commitment statement — version 2',
        changes: { status: { from: 'awaiting_signatures', to: 'signed' } },
      },
    ]);

    const content = await service.buildPdfContent({
      organisationId: EMPLOYER_ORG,
      statementId: 'stmt-2',
      requestedByUserId: 'user-1',
    });

    expect(content.entries).toEqual([
      {
        at: '2026-03-01T09:00:00.000Z',
        actorName: 'Priya Shah',
        actorRole: 'admin',
        action: AuditAction.SIGN,
        description: 'Signed commitment statement — version 2',
        changeSummary: 'status: awaiting_signatures → signed',
      },
    ]);
    expect(content.entryCount).toBe(1);
  });

  /**
   * An entry whose actor was erased under Article 17 must still appear — the
   * event happened. It just cannot name who did it.
   */
  it('says the actor is not recorded rather than guessing a name', async () => {
    auditRepo.find.mockResolvedValue([
      {
        createdAt: new Date('2026-02-01T09:00:00Z'),
        actorName: null,
        actorRole: null,
        action: AuditAction.UPDATE,
        entityType: 'commitment_statements',
        description: null,
        changes: {},
      },
    ]);

    const content = await service.buildPdfContent({
      organisationId: EMPLOYER_ORG,
      statementId: 'stmt-2',
      requestedByUserId: 'user-1',
    });

    expect(content.entries[0]).toMatchObject({
      actorName: 'Not recorded',
      actorRole: 'Not recorded',
      // Pre-AC2 rows have no stored description; one is derived so the line
      // is not blank.
      description: 'Edited commitment statement',
      changeSummary: null,
    });
  });

  it('identifies the record it belongs to', async () => {
    const content = await service.buildPdfContent({
      organisationId: EMPLOYER_ORG,
      statementId: 'stmt-2',
      requestedByUserId: 'user-1',
    });

    expect(content).toMatchObject({
      organisationName: 'Midlands Eng',
      statementId: 'stmt-2',
      currentVersion: 2,
      status: 'signed',
      apprenticeName: 'Amara Diallo',
      employerName: 'Midlands Eng',
      providerName: 'Skillsmith',
      generatedByName: 'Ada Lovelace',
    });
    expect(content.versions).toEqual([
      {
        version: 1,
        statementId: 'stmt-1',
        status: 'superseded',
        createdAt: '2026-01-01T09:00:00.000Z',
        supersededAt: '2026-03-01T09:00:00.000Z',
      },
      {
        version: 2,
        statementId: 'stmt-2',
        status: 'signed',
        createdAt: '2026-03-01T09:00:00.000Z',
        supersededAt: null,
      },
    ]);
  });

  it('authorises as a party before queueing, so a stranger gets 404 now', async () => {
    findStatementAsParty.mockRejectedValueOnce(new Error('not found'));

    await expect(
      service.requestExport(employerUser, 'stmt-2'),
    ).rejects.toThrow();
    expect(pdfDispatch.enqueue).not.toHaveBeenCalled();
  });

  it('queues the export against the caller organisation', async () => {
    findStatementAsParty.mockResolvedValue({ id: 'stmt-2' });
    pdfDispatch.enqueue.mockResolvedValue({
      id: 'job-1',
      status: 'queued',
      template: 'commitment_audit_trail',
      outputKey: null,
      errorMessage: null,
      createdAt: new Date('2026-04-01T09:00:00Z'),
      completedAt: null,
    });

    const result = await service.requestExport(employerUser, 'stmt-2');

    expect(pdfDispatch.enqueue).toHaveBeenCalledWith({
      organisationId: EMPLOYER_ORG,
      userId: 'user-1',
      template: 'commitment_audit_trail',
      statementId: 'stmt-2',
    });
    expect(result.jobId).toBe('job-1');
  });
});
