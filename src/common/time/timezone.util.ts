/**
 * Timezone-aware weekday helpers.
 *
 * F1.2.3 AC6 specifies "every Monday at 08:00 GMT". Every cron in this service
 * is constructed as `new CronJob(expression, onTick)` with no timezone, which
 * means the expression is evaluated in the server's local zone — so the same
 * deployment fires at a different real-world time depending on where the
 * container runs. Neither the hour nor the day can be honoured without naming
 * a zone explicitly.
 *
 * `Intl` is used rather than manual offset arithmetic because British Summer
 * Time is the whole difficulty: a fixed +0/+1 offset is wrong for half the
 * year, and "which day is it" changes with the offset near midnight.
 */

/** Long weekday name ("Monday") as observed in `timeZone`. */
export function weekdayIn(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
  }).format(date);
}

export function isMondayIn(date: Date, timeZone: string): boolean {
  return weekdayIn(date, timeZone) === 'Monday';
}
