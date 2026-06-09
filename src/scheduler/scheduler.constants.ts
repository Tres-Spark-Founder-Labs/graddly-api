/** Named cron job registered via SchedulerRegistry. */
export const HEALTH_CHECK_CRON_NAME = 'health-check';

/** Weekly digest cron (skeleton; disabled by default). */
export const DIGEST_CRON_NAME = 'digest-weekly-otj';

/** 15-minute DAS levy sync cron (Phase L). */
export const DAS_SYNC_CRON_NAME = 'das-levy-sync';

/** Nightly OTJ pace update cron. */
export const OTJ_PACE_CRON_NAME = 'otj-pace-nightly';

/** Nightly review overdue flag cron. */
export const REVIEW_OVERDUE_CRON_NAME = 'review-overdue-nightly';

/** Daily review reminder cron (7d and 1d). */
export const REVIEW_REMINDERS_CRON_NAME = 'review-reminders-daily';

/** Daily levy transfer DAS status sync cron. */
export const LEVY_TRANSFER_STATUS_CRON_NAME = 'levy-transfer-status-daily';

/** Daily levy expiry alert cron (90d and 30d). */
export const LEVY_EXPIRY_ALERTS_CRON_NAME = 'levy-expiry-alerts-daily';
