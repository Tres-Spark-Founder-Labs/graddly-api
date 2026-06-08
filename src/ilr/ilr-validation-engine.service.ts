/**
 * Config-driven ILR validation (subset of ESFA 2025-26 rules in v1).
 * GROWTH(ILR-RULES): import full rule spreadsheet annually; ReferenceDataService
 * for ULN/postcode online-only checks.
 */
import { Injectable } from '@nestjs/common';

import type {
  IlrFieldMap,
  IlrMappingConfigDocument,
  IlrValidationIssue,
  IlrValidationRuleDefinition,
  IlrValidationSummary,
} from './types/ilr-mapping-config.types.js';

export type IlrValidationReport = {
  issues: IlrValidationIssue[];
  summary: IlrValidationSummary;
  isValid: boolean;
};

@Injectable()
export class IlrValidationEngine {
  validate(
    config: IlrMappingConfigDocument,
    fields: IlrFieldMap,
  ): IlrValidationReport {
    const issues: IlrValidationIssue[] = [];

    for (const [entityName, entityFields] of Object.entries(config.entities)) {
      for (const [fieldName, definition] of Object.entries(entityFields)) {
        if (!definition.required) {
          continue;
        }
        const dotted = `${entityName}.${fieldName}`;
        const value = fields[entityName]?.[fieldName] ?? null;
        if (!value || !String(value).trim()) {
          issues.push({
            code: 'FIELD_REQUIRED',
            field: dotted,
            severity: 'error',
            message: `${dotted} is required but has no value.`,
          });
        }
      }
    }

    for (const rule of config.rules) {
      const issue = this.evaluateRule(rule, fields);
      if (issue) {
        issues.push(issue);
      }
    }

    const errorCount = issues.filter((i) => i.severity === 'error').length;
    const warnCount = issues.filter((i) => i.severity === 'warn').length;

    return {
      issues,
      summary: { errorCount, warnCount },
      isValid: errorCount === 0,
    };
  }

  private evaluateRule(
    rule: IlrValidationRuleDefinition,
    fields: IlrFieldMap,
  ): IlrValidationIssue | null {
    if (rule.type === 'required') {
      const value = this.readField(fields, rule.field);
      if (!value || !String(value).trim()) {
        return {
          code: rule.code,
          field: rule.field,
          severity: rule.severity,
          message: rule.message,
        };
      }
      return null;
    }

    if (rule.type === 'dateNotAfter') {
      const start = this.readField(fields, rule.field);
      const end = rule.otherField
        ? this.readField(fields, rule.otherField)
        : null;
      if (!start || !end) {
        return null;
      }
      if (start > end) {
        return {
          code: rule.code,
          field: rule.field,
          severity: rule.severity,
          message: rule.message,
        };
      }
    }

    return null;
  }

  private readField(fields: IlrFieldMap, dotted: string): string | null {
    const [entity, ...rest] = dotted.split('.');
    const fieldName = rest.join('.');
    return fields[entity]?.[fieldName] ?? null;
  }
}
