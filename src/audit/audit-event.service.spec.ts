import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  getRlsBootstrap,
  setRlsBootstrap,
} from '../common/context/correlation-id-context.js';

import { AUDIT_ENTITY_TYPE } from './audit-entity-types.js';
import { AuditEventService } from './audit-event.service.js';
import { AuditLogEntry } from './entities/audit-log-entry.entity.js';
import { AuditAction } from './enums/audit-action.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

jest.mock('../common/context/correlation-id-context.js', () => ({
  getCurrentActor: jest.fn(() => ({ name: 'Ada Lovelace', role: 'owner' })),
  getRlsBootstrap: jest.fn(() => false),
  setRlsBootstrap: jest.fn(),
}));

describe('AuditEventService (F1.3.3 AC1/AC2)', () => {
  const auditRepo = { insert: jest.fn() };
  let service: AuditEventService;

  const user = {
    id: 'user-1',
    organisationId: 'org-1',
    email: 'ada@example.com',
    roles: ['owner'],
  } as unknown as AuthenticatedUser;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuditEventService,
        { provide: getRepositoryToken(AuditLogEntry), useValue: auditRepo },
      ],
    }).compile();

    service = moduleRef.get(AuditEventService);
    jest.clearAllMocks();
    (getRlsBootstrap as jest.Mock).mockReturnValue(false);
  });

  /**
   * A `SELECT` is invisible to a TypeORM subscriber, so "each view" is only
   * recorded if the code serving the read records it.
   */
  it('records a view with the actor as they were at the time', async () => {
    await service.recordView({
      user,
      entityType: AUDIT_ENTITY_TYPE.COMMITMENT_STATEMENT,
      entityId: 'stmt-1',
      organisationId: 'org-2',
      detail: 'version 2',
    });

    expect(auditRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.VIEW,
        actorUserId: 'user-1',
        actorName: 'Ada Lovelace',
        actorRole: 'owner',
        description: 'Viewed commitment statement — version 2',
        entityType: AUDIT_ENTITY_TYPE.COMMITMENT_STATEMENT,
        entityId: 'stmt-1',
        organisationId: 'org-2',
      }),
    );
  });

  it('records a signature and a version change under their own actions', async () => {
    await service.recordSignature({
      user,
      entityType: AUDIT_ENTITY_TYPE.COMMITMENT_STATEMENT,
      entityId: 'stmt-1',
      organisationId: 'org-1',
    });
    await service.recordVersionChange({
      user,
      entityType: AUDIT_ENTITY_TYPE.COMMITMENT_STATEMENT,
      entityId: 'stmt-2',
      organisationId: 'org-1',
    });

    const actions = (auditRepo.insert.mock.calls as [{ action: string }][]).map(
      ([row]) => row.action,
    );
    expect(actions).toEqual([AuditAction.SIGN, AuditAction.VERSION_CHANGE]);
  });

  /**
   * The audit table's INSERT policy is org-scoped. A view recorded against a
   * statement owned by the *provider* would otherwise be refused by RLS —
   * the same read the employer is entitled to would log nothing.
   */
  it('writes under the RLS bootstrap flag and restores it afterwards', async () => {
    await service.recordView({
      user,
      entityType: AUDIT_ENTITY_TYPE.COMMITMENT_STATEMENT,
      entityId: 'stmt-1',
      organisationId: 'org-2',
    });

    expect(setRlsBootstrap).toHaveBeenNthCalledWith(1, true);
    expect(setRlsBootstrap).toHaveBeenNthCalledWith(2, false);
  });

  it('restores the previous flag rather than clearing it', async () => {
    (getRlsBootstrap as jest.Mock).mockReturnValue(true);

    await service.recordView({
      user,
      entityType: AUDIT_ENTITY_TYPE.COMMITMENT_STATEMENT,
      entityId: 'stmt-1',
      organisationId: 'org-1',
    });

    expect(setRlsBootstrap).toHaveBeenNthCalledWith(2, true);
  });

  /**
   * Deliberate trade against AC1's "complete": refusing to serve a commitment
   * statement because its view could not be logged would turn a reporting
   * problem into an outage.
   */
  it('never throws when the audit write fails', async () => {
    auditRepo.insert.mockRejectedValueOnce(new Error('deadlock detected'));

    await expect(
      service.recordView({
        user,
        entityType: AUDIT_ENTITY_TYPE.COMMITMENT_STATEMENT,
        entityId: 'stmt-1',
        organisationId: 'org-1',
      }),
    ).resolves.toBeUndefined();

    // ...and the flag is still put back, or every later write in the request
    // would run with RLS bypassed.
    expect(setRlsBootstrap).toHaveBeenNthCalledWith(2, false);
  });
});
