import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';

import { SurveyCampaign } from './survey-campaign.entity.js';

/** questionId → answer. Numbers for scales, strings for free text. */
export type SurveyAnswers = Record<string, number | string>;

/**
 * F2.4.3 AC2 — "sent via email with a unique link — no login required".
 *
 * The invitation and the response are one row. A separate responses table
 * would buy nothing: an invitation has at most one response, and splitting
 * them adds a join to every read of the results dashboard for the sake of a
 * cardinality that cannot occur.
 *
 * `tokenHash` rather than the token itself. The link is a bearer credential —
 * anyone holding it can answer as that employer — and a table of live tokens
 * is a table of live credentials. The plaintext token exists only in the email
 * and in the response the send endpoint returns.
 */
@Entity('survey_invitations')
@Index('UQ_survey_invitations_token_hash', ['tokenHash'], { unique: true })
@Index('IDX_survey_invitations_campaign', ['campaignId'])
export class SurveyInvitation extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  @Column({ type: 'uuid' })
  campaignId!: string;

  @ManyToOne(() => SurveyCampaign, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaignId' })
  campaign!: SurveyCampaign;

  /** The employer this invitation went to, when it maps to a known one. */
  @Column({ type: 'uuid', nullable: true })
  employerOrganisationId!: string | null;

  @Column({ type: 'varchar', length: 320 })
  contactEmail!: string;

  @Column({ type: 'varchar', length: 64 })
  tokenHash!: string;

  @Column({ type: 'timestamptz', nullable: true })
  respondedAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  answers!: SurveyAnswers | null;
}
