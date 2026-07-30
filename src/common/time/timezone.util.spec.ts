import { isMondayIn, weekdayIn } from './timezone.util.js';

describe('timezone helpers', () => {
  it('reads the weekday in the named zone, not the host zone', () => {
    // 23:30 UTC on Sunday is already Monday in Sydney. If the digest read the
    // host's weekday, a server deployed outside the UK would send on the
    // wrong day.
    const sundayNightUtc = new Date('2026-08-02T23:30:00Z');

    expect(weekdayIn(sundayNightUtc, 'UTC')).toBe('Sunday');
    expect(weekdayIn(sundayNightUtc, 'Australia/Sydney')).toBe('Monday');
  });

  it('identifies Monday in Europe/London', () => {
    expect(isMondayIn(new Date('2026-08-03T08:00:00Z'), 'Europe/London')).toBe(
      true,
    );
    expect(isMondayIn(new Date('2026-08-04T08:00:00Z'), 'Europe/London')).toBe(
      false,
    );
  });

  /**
   * F1.2.3 AC6 says "08:00 GMT". During British Summer Time, Europe/London is
   * UTC+1, so the two readings are an hour apart — which is exactly why the
   * zone is configurable rather than assumed.
   */
  it('distinguishes BST from UTC either side of midnight', () => {
    // 23:30 UTC on Sunday 2 August is 00:30 Monday in London (BST, UTC+1).
    const sundayLateUtc = new Date('2026-08-02T23:30:00Z');

    expect(isMondayIn(sundayLateUtc, 'UTC')).toBe(false);
    expect(isMondayIn(sundayLateUtc, 'Europe/London')).toBe(true);
  });

  it('treats London and UTC alike outside summer time', () => {
    // 2026-01-05 is a Monday; in January London is on GMT, so both agree.
    const januaryMonday = new Date('2026-01-05T08:00:00Z');

    expect(isMondayIn(januaryMonday, 'UTC')).toBe(true);
    expect(isMondayIn(januaryMonday, 'Europe/London')).toBe(true);
  });
});
