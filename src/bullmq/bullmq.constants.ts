/** Queue for transactional email jobs (Phase G). */
export const QUEUE_EMAIL = 'email';

/** Queue for digest notifications (Phase G). */
export const QUEUE_DIGEST = 'digest';

/** Weekly OTJ digest job (domain wiring in Phase M). */
export const DIGEST_JOB_WEEKLY_OTJ = 'weekly-otj-digest';

/** Queue for async PDF generation (Phase J). */
export const QUEUE_PDF = 'pdf';

/** Queue for DAS organisation sync jobs (Phase L). */
export const QUEUE_DAS_SYNC = 'das-sync';

/** Dedicated dead-letter queue for DAS sync terminal failures. */
export const QUEUE_DAS_SYNC_DLQ = 'das-sync-dlq';

/** Queue for outbound withdrawal completion pushes. */
export const QUEUE_WITHDRAWAL_PUSH = 'withdrawal-push';

/** Queue for async Ofsted evidence pack ZIP jobs (Phase R). */
export const QUEUE_EVIDENCE_PACK = 'evidence-pack';

/** Queue for async ILR ESFA submit jobs. */
export const QUEUE_ILR_SUBMIT = 'ilr-submit';

/** Dead-letter queue for terminal ILR submit failures. */
export const QUEUE_ILR_SUBMIT_DLQ = 'ilr-submit-dlq';

/** Internal queue for smoke / health jobs. */
export const QUEUE_SYSTEM = 'system';

export const BULLMQ_QUEUES = [
  QUEUE_EMAIL,
  QUEUE_DIGEST,
  QUEUE_PDF,
  QUEUE_DAS_SYNC,
  QUEUE_DAS_SYNC_DLQ,
  QUEUE_WITHDRAWAL_PUSH,
  QUEUE_EVIDENCE_PACK,
  QUEUE_ILR_SUBMIT,
  QUEUE_ILR_SUBMIT_DLQ,
  QUEUE_SYSTEM,
] as const;

export const SYSTEM_JOB_PING = 'ping';
