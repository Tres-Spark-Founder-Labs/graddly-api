import { CommitmentSignature } from '../commitments/entities/commitment-signature.entity.js';
import { CommitmentSignatureStatus } from '../commitments/enums/commitment-signature-status.enum.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { KsEvidenceItem } from '../portfolio/entities/ks-evidence-item.entity.js';
import { KsEvidenceStatus } from '../portfolio/enums/ks-evidence-status.enum.js';
import { ReviewRecord } from '../reviews/entities/review-record.entity.js';
import { ReviewSignature } from '../reviews/entities/review-signature.entity.js';
import { Review } from '../reviews/entities/review.entity.js';
import { ReviewSignatureStatus } from '../reviews/enums/review-signature-status.enum.js';

import { AuditLogSubscriber } from './audit-log.subscriber.js';
import { AuditLogEntry } from './entities/audit-log-entry.entity.js';
import { AuditAction } from './enums/audit-action.enum.js';

import type { InsertEvent, UpdateEvent } from 'typeorm';

jest.mock('../common/context/correlation-id-context.js', () => ({
  getCurrentUserId: jest.fn(() => 'actor-1'),
  // F1.3.3 AC2 — the subscriber now records who acted, not just their id.
  getCurrentActor: jest.fn(() => ({
    name: 'Ada Lovelace',
    role: 'owner',
  })),
  getRlsBootstrap: jest.fn(() => false),
  setRlsBootstrap: jest.fn(),
}));

describe('AuditLogSubscriber', () => {
  const subscriber = new AuditLogSubscriber();
  const insert = jest.fn();

  const manager = { insert };

  beforeEach(() => {
    insert.mockReset();
  });

  it('afterInsert writes audit row for audited entities', async () => {
    const entity = Object.assign(new Organisation(), {
      id: 'org-1',
      name: 'Acme',
      slug: 'acme',
    });

    const event = {
      entity,
      metadata: { tableName: 'organisations' },
      manager,
    } as unknown as InsertEvent<object>;

    await subscriber.afterInsert(event);

    expect(insert).toHaveBeenCalledTimes(1);
    const calls = insert.mock.calls as [
      unknown,
      {
        actorUserId: string;
        organisationId: string;
        entityType: string;
        entityId: string;
        action: AuditAction;
        changes: Record<string, { to: string }>;
      },
    ][];
    const row = calls[0][1];

    expect(row).toMatchObject({
      actorUserId: 'actor-1',
      organisationId: 'org-1',
      entityType: 'organisations',
      entityId: 'org-1',
      action: AuditAction.INSERT,
    });
    expect(row.changes.name).toEqual({ to: 'Acme' });
    expect(row.changes.slug).toEqual({ to: 'acme' });
  });

  it('afterInsert skips non-audited entities', async () => {
    const event = {
      entity: { id: 'x', constructor: Object },
      metadata: { tableName: 'users' },
      manager,
    } as unknown as InsertEvent<object>;

    await subscriber.afterInsert(event);

    expect(insert).not.toHaveBeenCalled();
  });

  it('afterInsert writes audit row for reviews', async () => {
    const entity = Object.assign(new Review(), {
      id: 'review-1',
      organisationId: 'org-1',
      enrolmentId: 'enrol-1',
      apprenticeId: 'app-1',
      scheduledAt: new Date('2026-06-01T10:00:00Z'),
      status: 'scheduled',
    });

    const event = {
      entity,
      metadata: { tableName: 'reviews' },
      manager,
    } as unknown as InsertEvent<object>;

    await subscriber.afterInsert(event);

    expect(insert).toHaveBeenCalledWith(
      AuditLogEntry,
      expect.objectContaining({
        organisationId: 'org-1',
        entityType: 'reviews',
        entityId: 'review-1',
        action: AuditAction.INSERT,
      }),
    );
  });

  it('afterInsert writes audit row for review_records', async () => {
    const entity = Object.assign(new ReviewRecord(), {
      id: 'record-1',
      organisationId: 'org-1',
      reviewId: 'review-1',
      payload: { smartGoals: [], wellbeing: { score: 5 } },
    });

    const event = {
      entity,
      metadata: { tableName: 'review_records' },
      manager,
    } as unknown as InsertEvent<object>;

    await subscriber.afterInsert(event);

    expect(insert).toHaveBeenCalledWith(
      AuditLogEntry,
      expect.objectContaining({
        entityType: 'review_records',
        entityId: 'record-1',
        action: AuditAction.INSERT,
      }),
    );
  });

  it('afterUpdate writes audit row for review_signatures', async () => {
    const before = Object.assign(new ReviewSignature(), {
      id: 'sig-1',
      organisationId: 'org-1',
      reviewId: 'review-1',
      status: ReviewSignatureStatus.PENDING,
      signatureRecordId: null,
    });
    const entity = Object.assign(new ReviewSignature(), {
      ...before,
      status: ReviewSignatureStatus.SIGNED,
      signatureRecordId: 'esign-1',
    });

    const event = {
      entity,
      databaseEntity: { ...before },
      metadata: { tableName: 'review_signatures' },
      manager,
    } as unknown as UpdateEvent<object>;

    await subscriber.afterUpdate(event);

    expect(insert).toHaveBeenCalledWith(
      AuditLogEntry,
      expect.objectContaining({
        entityType: 'review_signatures',
        entityId: 'sig-1',
        action: AuditAction.UPDATE,
        changes: expect.objectContaining({
          status: {
            from: ReviewSignatureStatus.PENDING,
            to: ReviewSignatureStatus.SIGNED,
          },
        }) as Record<string, { from?: unknown; to?: unknown }>,
      }),
    );
  });

  it('afterUpdate writes audit row for commitment_signatures', async () => {
    const before = Object.assign(new CommitmentSignature(), {
      id: 'csig-1',
      organisationId: 'org-1',
      statementId: 'stmt-1',
      status: CommitmentSignatureStatus.PENDING,
      signatureRecordId: null,
    });
    const entity = Object.assign(new CommitmentSignature(), {
      ...before,
      status: CommitmentSignatureStatus.SIGNED,
      signatureRecordId: 'esign-1',
    });

    const event = {
      entity,
      databaseEntity: { ...before },
      metadata: { tableName: 'commitment_signatures' },
      manager,
    } as unknown as UpdateEvent<object>;

    await subscriber.afterUpdate(event);

    expect(insert).toHaveBeenCalledWith(
      AuditLogEntry,
      expect.objectContaining({
        entityType: 'commitment_signatures',
        entityId: 'csig-1',
        action: AuditAction.UPDATE,
      }),
    );
  });

  it('afterUpdate writes audit row for ks_evidence_items', async () => {
    const before = Object.assign(new KsEvidenceItem(), {
      id: 'ev-1',
      organisationId: 'org-1',
      status: KsEvidenceStatus.DRAFT,
    });
    const entity = Object.assign(new KsEvidenceItem(), {
      ...before,
      status: KsEvidenceStatus.SUBMITTED,
    });

    const event = {
      entity,
      databaseEntity: { ...before },
      metadata: { tableName: 'ks_evidence_items' },
      manager,
    } as unknown as UpdateEvent<object>;

    await subscriber.afterUpdate(event);

    expect(insert).toHaveBeenCalledWith(
      AuditLogEntry,
      expect.objectContaining({
        entityType: 'ks_evidence_items',
        entityId: 'ev-1',
        action: AuditAction.UPDATE,
      }),
    );
  });

  it('afterUpdate skips when there are no scalar changes', async () => {
    const entity = Object.assign(new Organisation(), {
      id: 'org-1',
      name: 'Acme',
      slug: 'acme',
    });

    const event = {
      entity,
      databaseEntity: { ...entity },
      metadata: { tableName: 'organisations' },
      manager,
    } as unknown as UpdateEvent<object>;

    await subscriber.afterUpdate(event);

    expect(insert).not.toHaveBeenCalled();
  });
});
