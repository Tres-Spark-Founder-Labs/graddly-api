import { EpaCountdownBand } from './enums/epa-countdown-band.enum.js';
import {
  EPA_COUNTDOWN_AMBER_MIN_DAYS,
  EPA_COUNTDOWN_GREEN_MIN_DAYS,
  computeDaysToEpa,
  computeEpaCountdownBand,
} from './epa-countdown.js';

/**
 * F3.2.3 AC2 and client decision Q4.
 *
 * The PRD's prose ("green >90 / amber 30–90 / red <30") leaves days 90 and 30
 * ambiguous, and an acceptance criterion that will be signed off against needs
 * to be unambiguous. Every boundary here is asserted on *both* sides, so a
 * later off-by-one cannot pass — which is exactly the defect that was present
 * before this change, where day 90 fell into amber.
 */
describe('EPA countdown', () => {
  const NOW = new Date('2026-01-01T09:30:00.000Z');

  /** The date exactly `days` ahead of NOW, as YYYY-MM-DD. */
  function epaDateIn(days: number): string {
    const d = new Date('2026-01-01T00:00:00.000Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function bandIn(days: number, completedAt: Date | null = null) {
    return computeEpaCountdownBand({
      epaDate: epaDateIn(days),
      completedAt,
      now: NOW,
    });
  }

  describe('day counting', () => {
    it('counts whole calendar days regardless of the hour of the request', () => {
      const lateInTheDay = new Date('2026-01-01T23:59:59.000Z');
      expect(computeDaysToEpa('2026-01-31', NOW)).toBe(30);
      expect(computeDaysToEpa('2026-01-31', lateInTheDay)).toBe(30);
    });

    it('returns null when the provider has not confirmed a date (AC3)', () => {
      expect(computeDaysToEpa(null, NOW)).toBeNull();
    });

    it('goes negative once the date has passed', () => {
      expect(computeDaysToEpa(epaDateIn(-3), NOW)).toBe(-3);
    });
  });

  describe('colour bands, both sides of every boundary', () => {
    it('is green at the green floor and above', () => {
      expect(bandIn(EPA_COUNTDOWN_GREEN_MIN_DAYS)).toBe(EpaCountdownBand.GREEN);
      expect(bandIn(EPA_COUNTDOWN_GREEN_MIN_DAYS + 1)).toBe(
        EpaCountdownBand.GREEN,
      );
    });

    it('is amber one day below the green floor', () => {
      expect(bandIn(EPA_COUNTDOWN_GREEN_MIN_DAYS - 1)).toBe(
        EpaCountdownBand.AMBER,
      );
    });

    it('is amber at the amber floor', () => {
      expect(bandIn(EPA_COUNTDOWN_AMBER_MIN_DAYS)).toBe(EpaCountdownBand.AMBER);
    });

    it('is red one day below the amber floor', () => {
      expect(bandIn(EPA_COUNTDOWN_AMBER_MIN_DAYS - 1)).toBe(
        EpaCountdownBand.RED,
      );
    });

    /**
     * The specific regression this change fixes: day 90 used to fall through
     * `days > 90` into amber, contradicting the agreed "90 or more is green".
     */
    it('does not put day 90 in amber', () => {
      expect(bandIn(90)).not.toBe(EpaCountdownBand.AMBER);
      expect(bandIn(90)).toBe(EpaCountdownBand.GREEN);
    });
  });

  describe('edge cases the PRD does not cover (decision Q4a, Q4b)', () => {
    it('reads red on the day of the EPA rather than counting zero', () => {
      expect(computeDaysToEpa(epaDateIn(0), NOW)).toBe(0);
      expect(bandIn(0)).toBe(EpaCountdownBand.RED);
    });

    it('is overdue once the date has passed with no completion recorded', () => {
      expect(bandIn(-1)).toBe(EpaCountdownBand.OVERDUE);
      expect(bandIn(-40)).toBe(EpaCountdownBand.OVERDUE);
    });

    it('is not overdue when completion has been recorded', () => {
      expect(bandIn(-40, new Date('2026-01-01T00:00:00.000Z'))).not.toBe(
        EpaCountdownBand.OVERDUE,
      );
    });

    it('is unset when no EPA date is confirmed (AC3)', () => {
      expect(
        computeEpaCountdownBand({
          epaDate: null,
          completedAt: null,
          now: NOW,
        }),
      ).toBe(EpaCountdownBand.UNSET);
    });
  });
});
