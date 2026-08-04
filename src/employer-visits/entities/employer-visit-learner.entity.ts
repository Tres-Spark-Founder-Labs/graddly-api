import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Enrolment } from '../../enrolments/entities/enrolment.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';

import { EmployerVisit } from './employer-visit.entity.js';

/**
 * F2.4.2 AC2 — "visit records are linked to the relevant employer and learners
 * discussed".
 *
 * A join table rather than a `uuid[]` column on the visit, because the useful
 * question runs the other way: *"when was this apprentice last discussed with
 * their employer?"* is what a tutor preparing for a review actually asks, and
 * an array column cannot answer it without scanning every visit.
 *
 * `organisationId` is denormalised onto the join so row-level security can
 * partition it directly. Without it, every policy on this table would need a
 * subquery through `employer_visits`, and RLS subqueries are the thing that
 * quietly turns a fast page into a slow one.
 */
@Entity('employer_visit_learners')
@Index(
  'UQ_employer_visit_learners_visit_enrolment',
  ['visitId', 'enrolmentId'],
  {
    unique: true,
  },
)
@Index('IDX_employer_visit_learners_org_enrolment', [
  'organisationId',
  'enrolmentId',
])
export class EmployerVisitLearner extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  @Column({ type: 'uuid' })
  visitId!: string;

  @ManyToOne(() => EmployerVisit, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'visitId' })
  visit!: EmployerVisit;

  @Column({ type: 'uuid' })
  enrolmentId!: string;

  @ManyToOne(() => Enrolment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'enrolmentId' })
  enrolment!: Enrolment;
}
