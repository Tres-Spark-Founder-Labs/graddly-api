import { BadRequestException } from '@nestjs/common';

import { assertContiguousMonths } from './das-manual.service.js';

/**
 * The month set for a manual levy-utilisation entry.
 *
 * Three failure modes, and only two of them are errors:
 *
 *   duplicate month   a paste that repeated a row      — rejected
 *   interior gap      a paste that dropped a row       — rejected
 *   short set         a levy year still in progress    — allowed
 *
 * The interior gap is the one worth the code. Eleven months plotted across a
 * twelve-month axis renders as a complete trend and is wrong by whatever the
 * missing month held, which is exactly the shape of mistake that gets a wrong
 * number in front of a board.
 */
describe('assertContiguousMonths', () => {
  const run = (months: string[]) => () => assertContiguousMonths(months);

  describe('accepts', () => {
    it('a full twelve-month run', () => {
      const months = Array.from({ length: 12 }, (_, i) =>
        i < 9 ? `2026-0${i + 1}` : `2026-${i + 1}`,
      );
      expect(run(months)).not.toThrow();
    });

    it('a levy year in progress — seven months, not twelve', () => {
      // The case that makes "exactly 12" the wrong rule.
      expect(
        run([
          '2026-04',
          '2026-05',
          '2026-06',
          '2026-07',
          '2026-08',
          '2026-09',
          '2026-10',
        ]),
      ).not.toThrow();
    });

    it('a single month', () => {
      expect(run(['2026-04'])).not.toThrow();
    });

    it('a run crossing a year boundary', () => {
      // December to January is a gap of one, not eleven.
      expect(run(['2026-11', '2026-12', '2027-01', '2027-02'])).not.toThrow();
    });

    it('months supplied out of order, as long as the set is unbroken', () => {
      // The screen sorts, but the rule is about the set, not the ordering.
      expect(run(['2026-06', '2026-04', '2026-05'])).not.toThrow();
    });
  });

  describe('rejects', () => {
    it('a repeated month', () => {
      expect(run(['2026-04', '2026-05', '2026-05'])).toThrow(
        BadRequestException,
      );
      expect(run(['2026-04', '2026-05', '2026-05'])).toThrow(
        /appears more than once: 2026-05/,
      );
    });

    it('a single missing month in the middle', () => {
      expect(run(['2026-04', '2026-05', '2026-07'])).toThrow(
        /1 month is missing between 2026-05 and 2026-07/,
      );
    });

    it('several missing months, counted correctly', () => {
      expect(run(['2026-01', '2026-05'])).toThrow(
        /3 months are missing between 2026-01 and 2026-05/,
      );
    });

    it('a gap across a year boundary', () => {
      // 2026-12 to 2027-02 is one missing month, not thirteen.
      expect(run(['2026-12', '2027-02'])).toThrow(
        /1 month is missing between 2026-12 and 2027-02/,
      );
    });

    it('tells the operator to enter zero rather than omit the month', () => {
      // The message has to name the fix, because "contiguous" does not tell
      // someone what to do about a month with no contribution.
      expect(run(['2026-04', '2026-06'])).toThrow(/enter 0\.00/);
    });
  });
});
