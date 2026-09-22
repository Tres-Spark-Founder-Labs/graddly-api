import {
  EventSubscriber,
  type EntitySubscriberInterface,
  type InsertEvent,
  type SoftRemoveEvent,
  type UpdateEvent,
  EntityManager,
} from 'typeorm';

import {
  getCurrentActor,
  getCurrentUserId,
  withRlsBootstrap,
} from '../common/context/correlation-id-context.js';

import {
  buildDeleteChanges,
  buildInsertChanges,
  buildUpdateChanges,
} from './audit-changes.util.js';
import { describeAuditEvent } from './audit-description.util.js';
import {
  isAuditedEntity,
  resolveAuditOrganisationId,
  type OrganisationScopedEntity,
} from './audit-organisation-id.resolver.js';
import { AuditLogEntry } from './entities/audit-log-entry.entity.js';
import { AuditAction } from './enums/audit-action.enum.js';

import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity.js';

@EventSubscriber()
export class AuditLogSubscriber implements EntitySubscriberInterface {
  /**
   * Written in the audited write's own transaction, and not caught.
   *
   * ── IF THE AUDIT INSERT FAILS, THE WRITE FAILS (task 6.5) ────────────────
   *
   * Deliberately. The trail is evidence — "all data mutations logged ...
   * logs immutable" (NFR audit logging), the Ofsted-ready trail of F1.3.3 —
   * and a change that lands without its entry makes the trail silently
   * incomplete, which is worse than the change being refused: the person
   * sees an error and can retry, whereas a gap in the trail is found, if
   * ever, by an inspector. Capturing the failure "elsewhere" would be a
   * second store the trail does not include.
   *
   * No other request is affected: the rollback that follows is sent (see
   * isRollbackStatement in postgres-query-runner.patch.ts) and the
   * connection goes back to the pool clean. Proved in
   * test/pooled-connection-after-failure.e2e-spec.ts.
   */
  private async insertAuditEntry(
    manager: EntityManager,
    row: QueryDeepPartialEntity<AuditLogEntry>,
  ): Promise<void> {
    // Mutations may run before app.current_org matches the target row (e.g. org creation).
    await withRlsBootstrap(async () => {
      await manager.insert(AuditLogEntry, row);
    });
  }

  private buildRow(
    entity: OrganisationScopedEntity,
    entityType: string,
    entityId: string,
    action: AuditAction,
    changes: AuditLogEntry['changes'],
  ): QueryDeepPartialEntity<AuditLogEntry> {
    // F1.3.3 AC2 — name and role as they were at the time of the action.
    const actor = getCurrentActor();

    return {
      actorUserId: getCurrentUserId() ?? null,
      actorName: actor.name ?? null,
      actorRole: actor.role ?? null,
      description: describeAuditEvent(entityType, action),
      organisationId: resolveAuditOrganisationId(entity, entityType),
      entityType,
      entityId,
      action,
      changes: changes as QueryDeepPartialEntity<AuditLogEntry>['changes'],
    };
  }

  async afterInsert(event: InsertEvent<object>): Promise<void> {
    if (!isAuditedEntity(event.entity)) {
      return;
    }

    const entity = event.entity;
    const entityType = event.metadata.tableName;
    const entityId = (entity as { id: string }).id;
    if (!entityId) {
      return;
    }

    await this.insertAuditEntry(
      event.manager,
      this.buildRow(
        entity as OrganisationScopedEntity,
        entityType,
        entityId,
        AuditAction.INSERT,
        buildInsertChanges(entity),
      ),
    );
  }

  async afterUpdate(event: UpdateEvent<object>): Promise<void> {
    if (!event.entity || !isAuditedEntity(event.entity)) {
      return;
    }

    const entity = event.entity;
    const entityType = event.metadata.tableName;
    const entityId = (entity as { id: string }).id;
    if (!entityId) {
      return;
    }

    const before = event.databaseEntity ?? {};
    const changes = buildUpdateChanges(before, entity);
    if (Object.keys(changes).length === 0) {
      return;
    }

    await this.insertAuditEntry(
      event.manager,
      this.buildRow(entity, entityType, entityId, AuditAction.UPDATE, changes),
    );
  }

  async afterSoftRemove(event: SoftRemoveEvent<object>): Promise<void> {
    if (!event.entity || !isAuditedEntity(event.entity)) {
      return;
    }

    const entity = event.entity;
    const entityType = event.metadata.tableName;
    const entityId = (entity as { id: string }).id;
    if (!entityId) {
      return;
    }

    const before = event.databaseEntity ?? {};
    await this.insertAuditEntry(
      event.manager,
      this.buildRow(
        entity as OrganisationScopedEntity,
        entityType,
        entityId,
        AuditAction.DELETE,
        buildDeleteChanges(before, entity),
      ),
    );
  }
}
