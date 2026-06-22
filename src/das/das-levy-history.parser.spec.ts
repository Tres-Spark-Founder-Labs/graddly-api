import {
  parseLevyMonthlyEntries,
  parseUtilisationSegments,
} from './das-levy-history.parser.js';

describe('das-levy-history.parser', () => {
  describe('parseLevyMonthlyEntries', () => {
    it('merges contributions and spend from tolerant DAS keys', () => {
      const entries = parseLevyMonthlyEntries({
        monthlyContributions: [
          { month: '2025-01', amount: 1000 },
          { month: '2025-02', contribution: 1200 },
        ],
        transactions: [
          { period: '2025-01', spend: 400 },
          { date: '2025-02-15', spent: 500 },
        ],
      });

      expect(entries).toEqual([
        { month: '2025-01', contributions: 1000, spend: 400 },
        { month: '2025-02', contributions: 1200, spend: 500 },
      ]);
    });

    it('returns empty array when no monthly arrays are present', () => {
      expect(parseLevyMonthlyEntries({ balance: 100 })).toEqual([]);
    });
  });

  describe('parseUtilisationSegments', () => {
    it('reads direct segment fields when present', () => {
      expect(
        parseUtilisationSegments(
          {
            used: '10000',
            expiringWithin90Days: 2500,
            available: '5000',
          },
          '5000',
          'GBP',
        ),
      ).toEqual({
        used: 10000,
        expiringWithin90Days: 2500,
        available: 5000,
        currency: 'GBP',
      });
    });

    it('derives expiring amounts from tranche expiry dates', () => {
      const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const later = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      const segments = parseUtilisationSegments(
        {
          tranches: [
            { amount: 1000, expiresOn: soon },
            { amount: 2000, expiresOn: later },
            { amount: 500 },
          ],
        },
        '2500',
        'GBP',
      );

      expect(segments.expiringWithin90Days).toBe(1000);
      expect(segments.available).toBe(2500);
      expect(segments.used).toBe(500);
    });
  });
});
