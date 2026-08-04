import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';

import type { ISurveyQuestion } from '../enums/survey-question-type.enum.js';

/**
 * F2.4.3 AC1 — a configurable survey, up to ten questions.
 *
 * Questions live in a `jsonb` column rather than their own table. They are
 * only ever read as a whole set, never queried across templates, and — the
 * deciding reason — a campaign's results must keep meaning what they meant
 * when they were collected. A questions table invites editing a question after
 * responses exist, which silently rewrites the meaning of every answer already
 * given. The template is versioned by copying it onto the campaign instead.
 */
@Entity('survey_templates')
@Index('IDX_survey_templates_org', ['organisationId'])
export class SurveyTemplate extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'jsonb' })
  questions!: ISurveyQuestion[];
}
