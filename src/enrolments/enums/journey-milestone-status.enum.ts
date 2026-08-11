export enum JourneyMilestoneStatus {
  COMPLETE = 'complete',
  CURRENT = 'current',
  UPCOMING = 'upcoming',
  /**
   * Client decision Q2 — the timeline is sourced from reviews that actually
   * happened, so a review whose scheduled date has passed without being held
   * is shown as overdue rather than as still upcoming. An apprentice who can
   * see they are behind on reviews can chase it; one looking at an unticked
   * box cannot tell the difference between "not yet" and "missed".
   */
  OVERDUE = 'overdue',
  /**
   * A review that was cancelled. Distinct from `UPCOMING`, which it used to be
   * reported as — a cancelled review is not going to happen, and showing it as
   * still to come overstated what remained on the programme.
   */
  CANCELLED = 'cancelled',
}
