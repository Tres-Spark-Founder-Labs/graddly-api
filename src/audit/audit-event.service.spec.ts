import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { withRlsBootstrap } from '../common/context/correlation-id-context.js';

import { AUDIT_ENTITY_TYPE } from './audit-entity-types.js';
import { AuditEventService } from './audit-event.service.js';
import { AuditLogEntry } from './entities/audit-log-entry.entity.js';
import { AuditAction } from './enums/audit-action.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

/** How many bootstrap windows are open while a collaborator runs. */
let mockBootstrapDepth = 0;

jest.mock('../common/context/correlation-id-context.js', () => ({
  getCurrentActor: jest.fn(() => ({ name: 'Ada Lovelace', role: 'owner' })),
  withRlsBootstrap: jest.fn(async (fn: () => Promise<unknown>) => {
    mockBootstrapDepth += 1;
    try {
      return await fn();
    } finally {
      mockBootstrapDepth -= 1;
    }
  }),
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
    mockBootstrapDepth = 0;
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
   *
   * There is nothing to restore afterwards: the window is a derived store
   * that ends with the callback.
   */
  it('writes inside a bootstrap window', async () => {
    const depthAtInsert: number[] = [];
    auditRepo.insert.mockImplementation(() => {
      depthAtInsert.push(mockBootstrapDepth);
      return Promise.resolve();
    });

    await service.recordView({
      user,
      entityType: AUDIT_ENTITY_TYPE.COMMITMENT_STATEMENT,
      entityId: 'stmt-1',
      organisationId: 'org-2',
    });

    expect(depthAtInsert).toEqual([1]);
    expect(withRlsBootstrap).toHaveBeenCalledTimes(1);
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
  });
});
