import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';

import { SurveyTemplate } from './survey-template.entity.js';

import type { ISurveyQuestion } from '../enums/survey-question-type.enum.js';

/**
 * F2.4.3 — one send of a survey to a set of employer contacts.
 *
 * `questions` is **copied** from the template rather than referenced. Editing
 * a template after a campaign has collected answers would otherwise rewrite
 * what those answers meant — "strongly agree" against a question that has
 * since been reworded is not evidence of anything. The campaign is a
 * historical record and has to stay readable as one.
 */
@Entity('survey_campaigns')
@Index('IDX_survey_campaigns_org_closes', ['organisationId', 'closesAt'])
export class SurveyCampaign extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  @Column({ type: 'uuid', nullable: true })
  templateId!: string | null;

  @ManyToOne(() => SurveyTemplate, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'templateId' })
  template!: SurveyTemplate | null;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  /** Frozen copy of the template's questions at send time. */
  @Column({ type: 'jsonb' })
  questions!: ISurveyQuestion[];

  @Column({ type: 'timestamptz' })
  closesAt!: Date;

  /**
   * F2.4.3 AC4 — "results are available 24 hours after survey closes".
   *
   * Stored rather than computed from `closesAt + 24h` so the embargo stays
   * fixed if the close date is ever amended, and so the API can state the
   * exact moment results unlock rather than asking callers to do the maths.
   */
  @Column({ type: 'timestamptz' })
  resultsAvailableAt!: Date;
}
