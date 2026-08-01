import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';
import { EifRag } from '../enums/eif-rag.enum.js';

/** One criterion's score as it stood on the day it was captured. */
export type EifSnapshotCriterion = {
  slug: string;
  label: string;
  percent: number;
  rag: EifRag;
};

/**
 * F2.1.1 — "historical trend chart is available per criterion showing last 12
 * months of score movement".
 *
 * EIF scores are computed on demand from live data and held in Redis for an
 * hour. That is correct for the live hub — the criterion says scores must not
 * be cached longer than that — but it means the platform has never retained a
 * score for longer than sixty minutes, so there is nothing to draw a trend
 * from.
 *
 * It also cannot be back-filled. The score is a function of the OTJ logs,
 * reviews, portfolio evidence and documents *as they were on a given day*,
 * and those have all moved on. Last March's number is genuinely unrecoverable,
 * which is why this table exists now rather than when the chart is built:
 * every day without a snapshot is a day of history nobody can get back.
 *
 * **What is stored, and why it is denormalised.** One row per organisation per
 * day, holding the whole criteria set as JSON alongside the overall figure.
 * `overallPercent` is currently the mean of the criteria and could be derived
 * — it is stored anyway, on the same principle as the audit trail's
 * `actorName` in F1.3.3: a historical record should say what was *reported at
 * the time*, not what today's formula would produce from yesterday's parts. If
 * the weighting changes next year, the trend must not silently rewrite itself.
 */
@Entity('eif_score_snapshots')
@Index('UQ_eif_score_snapshots_org_day', ['organisationId', 'capturedOn'], {
  unique: true,
  where: `"isDeleted" = false`,
})
@Index('IDX_eif_score_snapshots_org_captured', ['organisationId', 'capturedOn'])
export class EifScoreSnapshot extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  /**
   * Calendar date, not a timestamp. A trend is read by day, and a `date`
   * column makes "one snapshot per day" a unique index rather than a
   * convention — re-running the cron cannot produce two points for one day.
   */
  @Column({ type: 'date' })
  capturedOn!: string;

  @Column({ type: 'int' })
  overallPercent!: number;

  @Column({
    type: 'enum',
    enum: EifRag,
    enumName: 'eif_rag',
  })
  overallRag!: EifRag;

  @Column({ type: 'jsonb' })
  criteria!: EifSnapshotCriterion[];
}
