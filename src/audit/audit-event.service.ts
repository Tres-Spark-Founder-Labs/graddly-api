import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  getCurrentActor,
  getRlsBootstrap,
  setRlsBootstrap,
} from '../common/context/correlation-id-context.js';

import { describeAuditEvent } from './audit-description.util.js';
import { AuditLogEntry } from './entities/audit-log-entry.entity.js';
import { AuditAction } from './enums/audit-action.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity.js';

/**
 * Records audit events the entity subscriber cannot see (F1.3.3 AC1).
 *
 * `AuditLogSubscriber` observes inserts, updates and deletes, which covers
 * "creation event" and "each edit". It cannot cover the rest:
 *
 *  - **Views** produce no row change at all. A `SELECT` is invisible to a
 *    subscriber, so "each view" has to be recorded by the code serving the
 *    read or it is not recorded.
 *  - **Signatures** do reach the subscriber, as an `update` to a
 *    `commitment_signatures` row. That is technically true and practically
 *    useless: an inspector reading the trail sees a column diff on a table
 *    they have never heard of, not "the employer signed version 2".
 *  - **Version changes** are an insert on `commitment_statements` plus an
 *    update to the superseded row — two entries describing a single act.
 *
 * So these are written deliberately, with a description in domain language.
 * They sit alongside the subscriber's entries rather than replacing them: the
 * subscriber keeps the column-level truth, this adds what a person did.
 */
@Injectable()
export class AuditEventService {
  private readonly logger = new Logger(AuditEventService.name);

  constructor(
    @InjectRepository(AuditLogEntry)
    private readonly auditRepo: Repository<AuditLogEntry>,
  ) {}

  /**
   * Writes an audit entry.
   *
   * **Never throws.** An audit write failing must not fail the action being
   * audited: refusing to serve a commitment statement because its view could
   * not be logged would turn a reporting problem into an outage. The failure
   * is logged at `warn` so a gap in the trail is visible in the logs rather
   * than silent.
   *
   * That is a deliberate trade against F1.3.3's "complete" — completeness of
   * the trail is preferred, but not at the cost of the platform working. If
   * the client needs a hard guarantee, the alternative is to fail the request,
   * which should be their decision rather than an implementation default.
   */
  async record(params: {
    user: AuthenticatedUser;
    action: AuditAction;
    entityType: string;
    entityId: string;
    organisationId: string | null;
    detail?: string;
    changes?: Record<string, unknown>;
  }): Promise<void> {
    const actor = getCurrentActor();

    const previousBootstrap = getRlsBootstrap();
    // The audit table's INSERT policy is org-scoped; a view recorded against
    // a statement owned by another organisation would otherwise be refused by
    // the very policy that lets an employer read it.
    setRlsBootstrap(true);
    try {
      await this.auditRepo.insert({
        actorUserId: params.user?.id ?? null,
        actorName: actor.name ?? null,
        actorRole: actor.role ?? null,
        description: describeAuditEvent(
          params.entityType,
          params.action,
          params.detail,
        ),
        organisationId: params.organisationId,
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
        // `insert` takes QueryDeepPartialEntity, which does not accept the
        // AuditChanges index signature directly.
        changes: (params.changes ??
          {}) as QueryDeepPartialEntity<AuditLogEntry>['changes'],
      });
    } catch (error) {
      this.logger.warn(
        `Audit ${params.action} not recorded for ${params.entityType} ${params.entityId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      setRlsBootstrap(previousBootstrap);
    }
  }

  /** AC1 — "each view". */
  async recordView(params: {
    user: AuthenticatedUser;
    entityType: string;
    entityId: string;
    organisationId: string | null;
    detail?: string;
  }): Promise<void> {
    return this.record({ ...params, action: AuditAction.VIEW });
  }

  /** AC1 — "each signature action". */
  async recordSignature(params: {
    user: AuthenticatedUser;
    entityType: string;
    entityId: string;
    organisationId: string | null;
    detail?: string;
  }): Promise<void> {
    return this.record({ ...params, action: AuditAction.SIGN });
  }

  /** AC1 — "any version changes". */
  async recordVersionChange(params: {
    user: AuthenticatedUser;
    entityType: string;
    entityId: string;
    organisationId: string | null;
    detail?: string;
  }): Promise<void> {
    return this.record({ ...params, action: AuditAction.VERSION_CHANGE });
  }
}
