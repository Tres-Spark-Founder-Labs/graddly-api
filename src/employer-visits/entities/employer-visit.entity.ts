import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';
import { EmployerVisitType } from '../enums/employer-visit-type.enum.js';

/**
 * F2.4.2 — a record of a tutor visiting an employer.
 *
 * Ofsted evidence first, admin second. The criterion asks for date, type,
 * attendees, discussion points, action points and a next visit date, and every
 * one of those is a question an inspector asks about employer engagement.
 *
 * `organisationId` is the **provider**, because the provider owns the record
 * of their own engagement activity. The employer being visited is
 * `employerOrganisationId`. Conflating the two would make a visit visible to
 * the employer's own portal by default, which is the wrong default for a
 * tutor's working notes — an action point saying "employer unresponsive, chase
 * MD" is written for the provider's file, not for the employer to read.
 */
@Entity('employer_visits')
@Index('IDX_employer_visits_org_employer_date', [
  'organisationId',
  'employerOrganisationId',
  'visitedOn',
])
@Index('IDX_employer_visits_org_date', ['organisationId', 'visitedOn'])
export class EmployerVisit extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  @Column({ type: 'uuid' })
  employerOrganisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employerOrganisationId' })
  employerOrganisation!: Organisation;

  @Column({ type: 'date' })
  visitedOn!: string;

  @Column({
    type: 'enum',
    enum: EmployerVisitType,
    enumName: 'employer_visit_type',
  })
  visitType!: EmployerVisitType;

  /**
   * Free text rather than user references.
   *
   * Most attendees at an employer visit are not platform users — a line
   * manager, an HR contact, an operations director. Modelling this as a list
   * of user ids would make the common case unrecordable, and a field that
   * cannot hold the truth gets left empty.
   */
  @Column({ type: 'text' })
  attendees!: string;

  @Column({ type: 'text' })
  discussionPoints!: string;

  @Column({ type: 'text', nullable: true })
  actionPoints!: string | null;

  /**
   * Nullable, and suggested rather than required (AC4). A tutor recording a
   * visit does not always know when the next one is, and a guessed date on an
   * Ofsted evidence record is worse than an honest blank.
   */
  @Column({ type: 'date', nullable: true })
  nextVisitDate!: string | null;

  @Column({ type: 'uuid', nullable: true })
  recordedByUserId!: string | null;
}
