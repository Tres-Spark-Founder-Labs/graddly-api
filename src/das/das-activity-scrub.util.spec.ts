import {
  DAS_ACTIVITY_ERROR_MAX_LENGTH,
  scrubDasActivitySummary,
  scrubDasActivityUrl,
  scrubDasActivityValue,
  truncateDasActivityError,
} from './das-activity-scrub.util.js';

/**
 * F2.3.1 AC7. These tests are the reason the activity log is safe to keep.
 *
 * The table is long-lived, readable by every member of the organisation, and
 * exported. If a bearer token ever reaches it, the log has made the platform
 * less secure than having no log — so redaction is tested by name, by nesting,
 * and by casing, not assumed.
 */
describe('das-activity-scrub', () => {
  describe('scrubDasActivityValue', () => {
    it('redacts credential-bearing keys regardless of spelling', () => {
      /* eslint-disable @typescript-eslint/naming-convention --
         The non-camelCase spellings are the subject of the test: these are the
         exact key names OAuth and HTTP use, and the scrubber has to catch them
         as they actually arrive, not as our style guide would write them. */
      const scrubbed = scrubDasActivityValue({
        access_token: 'secret-value',
        refreshToken: 'secret-value',
        Authorization: 'Bearer secret-value',
        client_secret: 'secret-value',
        apiKey: 'secret-value',
        password: 'secret-value',
      }) as Record<string, unknown>;
      /* eslint-enable @typescript-eslint/naming-convention */

      for (const value of Object.values(scrubbed)) {
        expect(value).toBe('[redacted]');
      }
    });

    it('redacts nested credentials, not just top-level ones', () => {
      const scrubbed = scrubDasActivityValue({
        learner: { uln: '1234567890' },
        auth: { nested: { accessToken: 'secret-value' } },
      }) as Record<string, Record<string, Record<string, unknown>>>;

      expect(scrubbed.auth.nested.accessToken).toBe('[redacted]');
      // Redaction must not be so broad it destroys the log's usefulness.
      expect(scrubbed.learner.uln).toBe('1234567890');
    });

    it('redacts inside arrays', () => {
      const scrubbed = scrubDasActivityValue([
        { token: 'secret-value', ref: 'keep-me' },
      ]) as Record<string, unknown>[];

      expect(scrubbed[0].token).toBe('[redacted]');
      expect(scrubbed[0].ref).toBe('keep-me');
    });

    it('stops recursing on pathological nesting rather than hanging', () => {
      let deep: Record<string, unknown> = { token: 'secret-value' };
      for (let i = 0; i < 50; i += 1) {
        deep = { level: deep };
      }
      expect(() => scrubDasActivityValue(deep)).not.toThrow();
    });

    it('leaves ordinary values untouched', () => {
      expect(scrubDasActivityValue({ ukprn: '10001234', count: 3 })).toEqual({
        ukprn: '10001234',
        count: 3,
      });
    });
  });

  describe('scrubDasActivityUrl', () => {
    it('redacts a token passed as a query parameter', () => {
      const scrubbed = scrubDasActivityUrl(
        'https://das.example.com/api/levy?ukprn=10001234&access_token=secret-value',
      );

      expect(scrubbed).toContain('ukprn=10001234');
      expect(scrubbed).not.toContain('secret-value');
    });

    it('returns an unparseable URL unchanged rather than losing the record', () => {
      expect(scrubDasActivityUrl('not-a-url')).toBe('not-a-url');
    });
  });

  describe('scrubDasActivitySummary', () => {
    it('returns null for absent input', () => {
      expect(scrubDasActivitySummary(null)).toBeNull();
      expect(scrubDasActivitySummary(undefined)).toBeNull();
    });

    it('wraps arrays and scalars so the column always holds an object', () => {
      expect(scrubDasActivitySummary(['a'])).toEqual({ items: ['a'] });
      expect(scrubDasActivitySummary('plain')).toEqual({ value: 'plain' });
    });
  });

  describe('truncateDasActivityError', () => {
    it('marks truncation so a clipped error is not read as the whole one', () => {
      const long = 'x'.repeat(DAS_ACTIVITY_ERROR_MAX_LENGTH + 100);
      const result = truncateDasActivityError(long);

      expect(result).toContain('[truncated]');
      expect(result!.length).toBeLessThan(long.length);
    });

    it('leaves a short message alone', () => {
      expect(truncateDasActivityError('boom')).toBe('boom');
      expect(truncateDasActivityError(null)).toBeNull();
    });
  });
});
