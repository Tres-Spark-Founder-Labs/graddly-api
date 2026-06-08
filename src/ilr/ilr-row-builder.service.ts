/**
 * Builds ILR field maps from domain entities via versioned mapping config.
 * GROWTH: new source paths as Apprentice/Enrolment gain ILR fields (ULN, DOB, etc.).
 */
import { Injectable } from '@nestjs/common';

import type {
  IlrFieldDefinition,
  IlrFieldMap,
  IlrMappingConfigDocument,
} from './types/ilr-mapping-config.types.js';
import type { Apprentice } from '../apprentices/entities/apprentice.entity.js';
import type { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import type { Organisation } from '../organisations/entities/organisation.entity.js';
import type { Standard } from '../programmes/entities/standard.entity.js';

export type IlrRowBuildContext = {
  enrolment: Enrolment;
  apprentice: Apprentice;
  standard: Standard;
  organisation: Organisation;
  manualOverrides: Record<string, string>;
};

@Injectable()
export class IlrRowBuilderService {
  buildFields(
    config: IlrMappingConfigDocument,
    context: IlrRowBuildContext,
  ): IlrFieldMap {
    const fields: IlrFieldMap = {};

    for (const [entityName, entityFields] of Object.entries(config.entities)) {
      fields[entityName] = {};
      for (const [fieldName, definition] of Object.entries(entityFields)) {
        const dottedKey = `${entityName}.${fieldName}`;
        fields[entityName][fieldName] = this.resolveField(
          definition,
          dottedKey,
          context,
        );
      }
    }

    return fields;
  }

  private resolveField(
    definition: IlrFieldDefinition,
    dottedKey: string,
    context: IlrRowBuildContext,
  ): string | null {
    if (definition.source === 'manual') {
      return context.manualOverrides[dottedKey] ?? null;
    }
    if (definition.source === 'constant') {
      return definition.value ?? null;
    }

    const raw = this.readSourceValue(definition.source, context);
    if (raw === null || raw === undefined || raw === '') {
      return null;
    }
    const asString =
      typeof raw === 'string' || typeof raw === 'number' ? String(raw) : null;
    if (asString === null) {
      return null;
    }
    return this.applyTransform(asString, definition.transform);
  }

  private readSourceValue(
    source: IlrFieldDefinition['source'],
    context: IlrRowBuildContext,
  ): unknown {
    const [root, ...rest] = source.split('.');
    const path = rest.join('.');

    switch (root) {
      case 'enrolment':
        return this.readPath(context.enrolment, path);
      case 'apprentice':
        return this.readPath(context.apprentice, path);
      case 'standard':
        return this.readPath(context.standard, path);
      case 'organisation':
        return this.readPath(context.organisation, path);
      default:
        return null;
    }
  }

  private readPath(obj: object, path: string): unknown {
    return (obj as Record<string, unknown>)[path] ?? null;
  }

  private applyTransform(
    value: string,
    transform?: IlrFieldDefinition['transform'],
  ): string {
    if (!transform) {
      return value;
    }
    if (transform === 'ilrDate') {
      return value.replace(/-/g, '');
    }
    if (transform === 'ilrRef') {
      return value.replace(/-/g, '').slice(0, 12).toUpperCase();
    }
    return value;
  }
}
