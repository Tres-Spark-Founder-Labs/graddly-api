import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { Apprentice } from '../../apprentices/entities/apprentice.entity.js';
import { BaseEntity } from '../../common/entities/base.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';
import { OtjPaceAlertLevel } from '../../otj/enums/otj-pace-alert-level.enum.js';
import { Standard } from '../../programmes/entities/standard.entity.js';
import { EnrolmentPipelineState } from '../enums/enrolment-pipeline-state.enum.js';
import { EnrolmentStatus } from '../enums/enrolment-status.enum.js';

@Entity('enrolments')
@Index(
  'UQ_enrolments_active_org_apprentice_standard',
  ['organisationId', 'apprenticeId', 'standardId'],
  {
    unique: true,
    where: `"isDeleted" = false AND "status" IN ('draft', 'active')`,
  },
)
@Index('IDX_enrolments_org_employer_org', [
  'organisationId',
  'employerOrganisationId',
])
@Index('IDX_enrolments_org_provider_org', [
  'organisationId',
  'providerOrganisationId',
])
@Index('IDX_enrolments_active_status', ['status'], {
  where: `"isDeleted" = false`,
})
export class Enrolment extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  @Column({ type: 'uuid' })
  apprenticeId!: string;

  @ManyToOne(() => Apprentice, (apprentice) => apprentice.enrolments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'apprenticeId' })
  apprentice!: Apprentice;

  @Column({ type: 'uuid' })
  standardId!: string;

  @ManyToOne(() => Standard, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'standardId' })
  standard!: Standard;

  @Column({
    type: 'enum',
    enum: EnrolmentStatus,
    enumName: 'enrolment_status',
    default: EnrolmentStatus.DRAFT,
  })
  status!: EnrolmentStatus;

  @Column({ type: 'timestamptz', nullable: true })
  activatedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  agreedPrice!: string | null;

  @Column({ type: 'date', nullable: true })
  plannedStartDate!: string | null;

  @Column({ type: 'date', nullable: true })
  plannedEndDate!: string | null;

  @Column({ type: 'int', nullable: true })
  plannedDurationMonths!: number | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  completionPaymentPercent!: string | null;

  @Column({ type: 'uuid', nullable: true })
  apprenticeUserId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  tutorUserId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  employerManagerUserId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  employerOrganisationId!: string | null;

  @ManyToOne(() => Organisation, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'employerOrganisationId' })
  employerOrganisation!: Organisation | null;

  @Column({ type: 'uuid', nullable: true })
  providerOrganisationId!: string | null;

  @ManyToOne(() => Organisation, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'providerOrganisationId' })
  providerOrganisation!: Organisation | null;

  @Column({
    type: 'enum',
    enum: EnrolmentPipelineState,
    enumName: 'enrolment_pipeline_state',
    nullable: true,
  })
  pipelineState!: EnrolmentPipelineState | null;

  @Column({ type: 'timestamptz', nullable: true })
  pipelineInvitedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  pipelineAccountCreatedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  pipelineProviderAcceptedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  pipelineIlrCreatedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  pipelineDasConfirmedAt!: Date | null;

  @Column({ type: 'date', nullable: true })
  epaDate!: string | null;

  @Column({
    type: 'enum',
    enum: OtjPaceAlertLevel,
    enumName: 'otj_pace_alert_level',
    nullable: true,
  })
  otjPaceAlertLevel!: OtjPaceAlertLevel | null;

  @Column({ type: 'timestamptz', nullable: true })
  otjPaceAlertedAt!: Date | null;

  /**
   * How far behind the required OTJ pace, as a percentage (F1.2.4 AC5).
   * Null when pace cannot be computed — which is not the same as zero.
   *
   * `numeric` columns come back from pg as strings, so this is typed
   * accordingly at the boundary and coerced when read.
   */
  @Column({ type: 'numeric', precision: 6, scale: 2, nullable: true })
  otjBehindPercent!: string | number | null;

  @Column({ type: 'timestamptz', nullable: true })
  gatewayReadyNotifiedAt!: Date | null;
}
