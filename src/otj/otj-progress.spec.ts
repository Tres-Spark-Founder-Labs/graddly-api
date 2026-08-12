import { OtjProgressBand } from './enums/otj-progress-band.enum.js';
import {
  OTJ_PROGRESS_AMBER_MIN_PERCENT,
  OTJ_PROGRESS_GREEN_MIN_PERCENT,
  computeOtjProgressBand,
  computeProjectedCompletionDate,
} from './otj-progress.js';

describe('OTJ progress (F3.1.2)', () => {
  describe('AC2 — ring colour bands, both sides of every boundary', () => {
    it('is green at the green floor and above', () => {
      expect(computeOtjProgressBand(OTJ_PROGRESS_GREEN_MIN_PERCENT)).toBe(
        OtjProgressBand.GREEN,
      );
      expect(computeOtjProgressBand(99.9)).toBe(OtjProgressBand.GREEN);
      expect(computeOtjProgressBand(100)).toBe(OtjProgressBand.GREEN);
    });

    it('is amber just below the green floor', () => {
      expect(computeOtjProgressBand(OTJ_PROGRESS_GREEN_MIN_PERCENT - 0.1)).toBe(
        OtjProgressBand.AMBER,
      );
    });

    it('is amber at the amber floor', () => {
      expect(computeOtjProgressBand(OTJ_PROGRESS_AMBER_MIN_PERCENT)).toBe(
        OtjProgressBand.AMBER,
      );
    });

    it('is red just below the amber floor', () => {
      expect(computeOtjProgressBand(OTJ_PROGRESS_AMBER_MIN_PERCENT - 0.1)).toBe(
        OtjProgressBand.RED,
      );
      expect(computeOtjProgressBand(0)).toBe(OtjProgressBand.RED);
    });

    /**
     * The boundary reading is an assumption carried from the client's EPA
     * countdown decision (Q4: "90 or more is green"), not a decision on this
     * criterion. Pinned so that changing it is deliberate and visible.
     */
    it('places the boundary in the higher band, per the Q4 precedent', () => {
      expect(computeOtjProgressBand(70)).toBe(OtjProgressBand.GREEN);
      expect(computeOtjProgressBand(50)).toBe(OtjProgressBand.AMBER);
    });

    it('is unknown when no target could be computed', () => {
      expect(computeOtjProgressBand(null)).toBe(OtjProgressBand.UNKNOWN);
    });
  });

  describe('AC5 — projected completion date', () => {
    const NOW = new Date('2026-07-01T00:00:00.000Z');

    it('projects from observed pace, not from the required pace', () => {
      // 100 days elapsed, 1000 minutes approved => 10 min/day.
      // 1000 remaining => 100 more days => 9 October 2026.
      const projected = computeProjectedCompletionDate({
        approvedMinutes: 1000,
        totalTargetMinutes: 2000,
        startDate: '2026-03-23',
        now: NOW,
      });

      expect(projected).toBe('2026-10-09');
    });

    it('projects further out for a slower learner', () => {
      const fast = computeProjectedCompletionDate({
        approvedMinutes: 1000,
        totalTargetMinutes: 2000,
        startDate: '2026-03-23',
        now: NOW,
      });
      const slow = computeProjectedCompletionDate({
        approvedMinutes: 500,
        totalTargetMinutes: 2000,
        startDate: '2026-03-23',
        now: NOW,
      });

      expect(slow! > fast!).toBe(true);
    });

    describe('returns null rather than guessing', () => {
      it('when nothing has been approved yet', () => {
        expect(
          computeProjectedCompletionDate({
            approvedMinutes: 0,
            totalTargetMinutes: 2000,
            startDate: '2026-03-23',
            now: NOW,
          }),
        ).toBeNull();
      });

      it('when the programme has not started', () => {
        expect(
          computeProjectedCompletionDate({
            approvedMinutes: 100,
            totalTargetMinutes: 2000,
            startDate: '2026-07-01',
            now: NOW,
          }),
        ).toBeNull();
      });

      it('when the target is already met', () => {
        expect(
          computeProjectedCompletionDate({
            approvedMinutes: 2500,
            totalTargetMinutes: 2000,
            startDate: '2026-03-23',
            now: NOW,
          }),
        ).toBeNull();
      });

      it('when there is no start date or no target', () => {
        expect(
          computeProjectedCompletionDate({
            approvedMinutes: 100,
            totalTargetMinutes: 2000,
            startDate: null,
            now: NOW,
          }),
        ).toBeNull();
        expect(
          computeProjectedCompletionDate({
            approvedMinutes: 100,
            totalTargetMinutes: 0,
            startDate: '2026-03-23',
            now: NOW,
          }),
        ).toBeNull();
      });
    });
  });
});
