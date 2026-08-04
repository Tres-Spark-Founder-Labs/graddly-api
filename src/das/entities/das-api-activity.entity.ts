import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';
import { DasApiOperation } from '../enums/das-api-operation.enum.js';

/**
 * F2.3.1 AC7 — "full API activity log with each request, response code, and
 * any error messages".
 *
 * There was no record of a DAS call ever having happened. Failures surfaced as
 * an `InternalServerErrorException` with the status code interpolated into a
 * message string, which reached a log line and nowhere else. A provider asking
 * *"did our submission actually go to the ESFA, and what did they say"* had no
 * answer, and neither did we.
 *
 * One row per HTTP call, written whether it succeeded or failed. Failure is
 * the case this table exists for, so a row is written before the exception is
 * thrown rather than after the caller handles it.
 *
 * NOTHING FROM THE AUTHORIZATION HEADER IS STORED HERE. The URL is recorded
 * with its query string because that is what identifies the call, but bearer
 * tokens live only in headers and are never copied into `requestSummary`. An
 * audit table that leaks credentials is worse than no audit table — see
 * `scrubDasActivityValue`.
 */
@Entity('das_api_activity')
@Index('IDX_das_api_activity_org_created', ['organisationId', 'createdAt'])
// Partial index: the sync-health read (AC5) only ever asks for failures, and
// they are a small minority of a table that grows with every call.
@Index('IDX_das_api_activity_org_failures', ['organisationId', 'createdAt'], {
  where: `"succeeded" = false`,
})
export class DasApiActivity extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  /**
   * Which DAS operation this was, as a stable enum rather than the URL.
   * Paths are configuration and change between ESFA environments; "this was a
   * completion notification" has to stay true across that.
   */
  @Column({
    type: 'enum',
    enum: DasApiOperation,
    enumName: 'das_api_operation',
  })
  operation!: DasApiOperation;

  @Column({ type: 'varchar', length: 10 })
  method!: string;

  @Column({ type: 'text' })
  url!: string;

  /**
   * Null when the request never got a reply — a timeout or a DNS failure has
   * no status code. Distinguishing "the ESFA said 500" from "we never reached
   * the ESFA" is the first question asked about a failed submission, so the
   * null is meaningful rather than missing data.
   */
  @Column({ type: 'int', nullable: true })
  responseStatus!: number | null;

  /**
   * Denormalised from `responseStatus`, because "was this a failure" must stay
   * answerable for transport errors where there is no status at all, and
   * because the partial index above needs a concrete column to filter on.
   */
  @Column({ type: 'boolean', default: false })
  succeeded!: boolean;

  @Column({ type: 'int' })
  durationMs!: number;

  /** The ESFA's error body, or our transport error. Truncated on write. */
  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  /**
   * Scrubbed request body or query parameters — enough to identify which
   * learner or transfer the call concerned, never enough to replay it.
   */
  @Column({ type: 'jsonb', nullable: true })
  requestSummary!: Record<string, unknown> | null;

  /** Set for calls made by a person; null for cron-driven sync cycles. */
  @Column({ type: 'uuid', nullable: true })
  triggeredByUserId!: string | null;
}
