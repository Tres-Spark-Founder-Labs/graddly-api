import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { SarReportStatus } from '../enums/sar-report-status.enum.js';
import { SarGrade } from '../sar-template.config.js';

/** One section of the report: seeded by generation, then edited by a human. */
export type SarSection = {
  key: string;
  heading: string;
  /**
   * The provider's own words. Generation seeds this with a factual paragraph
   * built from live data; everything after that is theirs. We never overwrite
   * it silently — see `SarReportsService.regenerate`.
   */
  narrative: string;
  /** Self-assessed grade, where the section carries one. Never inferred. */
  grade: SarGrade | null;
};

/**
 * The numbers behind the report, frozen at lock time.
 *
 * Deliberately a flat snapshot rather than references to live tables. Every
 * figure here changes daily, and AC4's "historical record" is worthless if
 * reopening the 2025-26 SAR in 2029 recomputes it from 2029's data.
 */
export type SarMetrics = {
  eifOverallPercent: number | null;
  eifCriteria: { slug: string; label: string; percent: number; rag: string }[];
  qip: {
    total: number;
    completed: number;
    overdue: number;
    percentComplete: number;
  };
  outcomes: {
    activeCount: number;
    completedCount: number;
    withdrawnCount: number;
    epaPassRate: number | null;
    epaAssessedCount: number;
  };
  reviewComplianceRate: number | null;
  withdrawalRate: number | null;
  /** Denormalised so a deleted user does not blank the historical record. */
  generatedByName: string | null;
  lockedByName: string | null;
  organisationName: string | null;
  capturedAt: string;
};

/**
 * F2.1.3 — a provider's Self-Assessment Report for one academic year.
 *
 * The platform generates the evidence; the provider writes the judgement.
 * That split is the design: a SAR that a system wrote by itself would be
 * neither honest nor useful, because the grade is a claim the provider has to
 * be willing to defend to an inspector. What the platform can do is stop them
 * hunting for the numbers, and stop the numbers being wrong.
 *
 * Locking is enforced by a database trigger as well as the service, because
 * three separate code paths write this table and a "historical record" that
 * one forgotten `save()` can rewrite is not a record at all.
 */
@Entity('sar_reports')
@Index(['organisationId', 'academicYear'])
export class SarReport extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  /** `2025-26`, matching the ILR convention already used across the platform. */
  @Column({ type: 'varchar', length: 9 })
  academicYear!: string;

  @Column({
    type: 'enum',
    enum: SarReportStatus,
    enumName: 'sar_report_status',
    default: SarReportStatus.DRAFT,
  })
  status!: SarReportStatus;

  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  sections!: SarSection[];

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  metrics!: SarMetrics;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  generatedAt!: Date;

  @Column({ type: 'uuid', nullable: true })
  generatedByUserId!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'generatedByUserId' })
  generatedBy!: User | null;

  @Column({ type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  lockedByUserId!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'lockedByUserId' })
  lockedBy!: User | null;
}
