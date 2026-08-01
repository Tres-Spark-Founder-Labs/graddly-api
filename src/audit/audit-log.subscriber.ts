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
  getRlsBootstrap,
  setRlsBootstrap,
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
  private async insertAuditEntry(
    manager: EntityManager,
    row: QueryDeepPartialEntity<AuditLogEntry>,
  ): Promise<void> {
    // Mutations may run before app.current_org matches the target row (e.g. org creation).
    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    try {
      await manager.insert(AuditLogEntry, row);
    } finally {
      setRlsBootstrap(previousBootstrap);
    }
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
