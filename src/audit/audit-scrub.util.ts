import type { AuditChanges } from './entities/audit-log-entry.entity.js';

const PII_FIELD_NAMES = new Set([
  'firstName',
  'lastName',
  'email',
  'phone',
  'dateOfBirth',
  'avatarUrl',
  'bio',
  'body',
  'note',
  'title',
  'jobTitle',
  'department',
]);

const ERASED = '[erased]';

function looksLikeEmail(value: unknown): boolean {
  return typeof value === 'string' && value.includes('@');
}

function scrubValue(
  value: unknown,
  fieldName: string,
  subjectEmail?: string,
): unknown {
  if (value === undefined || value === null) {
    return value;
  }

  if (PII_FIELD_NAMES.has(fieldName)) {
    return ERASED;
  }

  if (typeof value === 'string') {
    if (
      subjectEmail &&
      value.toLowerCase().includes(subjectEmail.toLowerCase())
    ) {
      return ERASED;
    }
    if (looksLikeEmail(value)) {
      return ERASED;
    }
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return scrubAuditChanges(value as AuditChanges, subjectEmail);
  }

  return value;
}

export function scrubAuditChanges(
  changes: AuditChanges,
  subjectEmail?: string,
): AuditChanges {
  const scrubbed: AuditChanges = {};
  for (const [field, change] of Object.entries(changes)) {
    scrubbed[field] = {
      from: scrubValue(change.from, field, subjectEmail),
      to: scrubValue(change.to, field, subjectEmail),
    };
  }
  return scrubbed;
}

export { ERASED };
