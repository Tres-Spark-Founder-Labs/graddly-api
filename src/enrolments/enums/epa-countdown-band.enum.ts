export enum EpaCountdownBand {
  GREEN = 'green',
  AMBER = 'amber',
  RED = 'red',
  /** EPA date has passed with no completion recorded (client decision Q4b). */
  OVERDUE = 'overdue',
  /** No EPA date set by the provider yet (F3.2.3 AC3). */
  UNSET = 'unset',
}
