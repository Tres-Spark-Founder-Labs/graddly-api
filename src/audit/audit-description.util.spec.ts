import { describeAuditEvent, entityLabel } from './audit-description.util.js';
import { AuditAction } from './enums/audit-action.enum.js';

describe('audit description (F1.3.3 AC2)', () => {
  describe('entityLabel', () => {
    /**
     * Keyed by table name — that is what the subscriber writes into
     * `entityType`, so a map keyed by class name would never match.
     */
    it('uses the domain wording where one is defined', () => {
      expect(entityLabel('commitment_statements')).toBe('commitment statement');
      expect(entityLabel('otj_log_entries')).toBe('off-the-job log entry');
    });

    it('reads an unmapped table name rather than printing it raw', () => {
      expect(entityLabel('das_sync_batches')).toBe('das sync batches');
    });

    it('still reads sensibly if handed a class name', () => {
      expect(entityLabel('ReviewRecord')).toBe('review record');
    });
  });

  describe('describeAuditEvent', () => {
    it('describes what a person did, not which columns moved', () => {
      expect(
        describeAuditEvent('commitment_statements', AuditAction.VIEW),
      ).toBe('Viewed commitment statement');
      expect(
        describeAuditEvent('commitment_statements', AuditAction.VERSION_CHANGE),
      ).toBe('Created a new version of commitment statement');
    });

    it('appends detail the entity type cannot supply', () => {
      expect(
        describeAuditEvent(
          'commitment_statements',
          AuditAction.SIGN,
          'version 2 signed as employer_manager',
        ),
      ).toBe(
        'Signed commitment statement — version 2 signed as employer_manager',
      );
    });

    it('covers every action, so no entry is ever described as "Changed"', () => {
      for (const action of Object.values(AuditAction)) {
        expect(
          describeAuditEvent('commitment_statements', action),
        ).not.toContain('Changed');
      }
    });

    /**
     * The column is varchar(500). A description long enough to overflow it
     * would otherwise fail the insert — and because the audit write happens
     * inside the action being audited, that would take a legitimate signature
     * or view down with it.
     */
    it('truncates to fit the column rather than failing the insert', () => {
      const result = describeAuditEvent(
        'commitment_statements',
        AuditAction.SIGN,
        'x'.repeat(900),
      );

      expect(result.length).toBe(500);
      expect(result.endsWith('...')).toBe(true);
    });
  });
});
