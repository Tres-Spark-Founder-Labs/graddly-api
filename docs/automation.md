# Automation crons (Phase 10)

Background jobs for commitment chasers, weekly OTJ digest emails, and apprentice 48h review reminders.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `CRON_COMMITMENT_CHASE_ENABLED` | `false` | Daily unsigned commitment chase |
| `CRON_COMMITMENT_CHASE_SCHEDULE` | `0 6 * * *` | Chase cron expression (06:00 UTC) |
| `CRON_DIGEST_ENABLED` | `false` | Weekly OTJ digest cron |
| `CRON_DIGEST_SCHEDULE` | `0 8 * * 1` | Digest cron (Monday 08:00 UTC) |
| `CRON_REVIEW_REMINDERS_ENABLED` | `false` | Review reminder cron |
| `CRON_REVIEW_REMINDERS_SCHEDULE` | `0 * * * *` | Hourly (48h apprentice); 7d/1d at 07:00 UTC |

All crons respect `CRON_ENABLED` and `CronLockService` Redis locking.

## PRD-019 — Commitment unsigned chase

**Service:** `CommitmentChaseService.sendDueChases()`

- Scans `commitment_statements` with `status = awaiting_signatures`
- Targets the current pending signer (lowest `signOrder` with `status = pending`)
- Eligible when unsigned for **7+ days** since turn start (predecessor sign time or slot `createdAt`)
- Idempotent via `commitment_chase_dispatches` (`signatureId` + `7d`)
- Sends `NotificationType.COMMITMENT` in-app + email (`commitment-chase` or `commitment-ready-to-sign` on first notify)

After commitment snapshot PDF generation, `notifyFirstSigner` emails the apprentice (or first pending party) so the chase is a reminder, not the first touch.

## PRD-023 — Weekly OTJ digest

**Flow:** `DigestCronService` → `DigestDispatchService` → `DigestProcessor` → `OtjDigestService`

- Cron scans orgs with `otj_log_entries.status = submitted`
- Processor groups pending entries by `enrolment.employerManagerUserId`
- One `otj-weekly-digest` email per manager (skips when `DIGEST` + `OTJ` preference disabled)

**Note:** Manager digest frequency (`daily` / `weekly` / `off`) UI is deferred; v1 ships weekly only via cron schedule.

## PRD-024 — Apprentice 48h review reminder

**Service:** `ReviewsReminderService.sendDueReminders()`

| Kind | Recipients | Schedule |
|---|---|---|
| `7d` | Tutor, apprentice, employer manager | Daily 07:00 UTC |
| `1d` | All three signers | Daily 07:00 UTC |
| `48h` | **Apprentice only** | Hourly window ±1h around `scheduledAt - 48h` |

Dedup via `review_reminder_dispatches` (`reviewId` + `reminderKind`). Postgres enum `review_reminder_kind` includes `48h` (migration `1781100000013`).

## Tests

```bash
yarn test commitment-chase otj-digest digest.processor digest-cron reviews-reminder
yarn test:e2e test/commitment-chase.e2e-spec.ts test/digest.e2e-spec.ts test/review-reminders.e2e-spec.ts
```
