import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Enrolment } from '../../enrolments/entities/enrolment.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { InterventionActionType } from '../enums/intervention-action-type.enum.js';

@Entity('intervention_actions')
@Index('IDX_intervention_actions_org_enrolment', [
  'organisationId',
  'enrolmentId',
])
export class InterventionAction extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  @Column({ type: 'uuid' })
  enrolmentId!: string;

  @ManyToOne(() => Enrolment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'enrolmentId' })
  enrolment!: Enrolment;

  @Column({
    type: 'enum',
    enum: InterventionActionType,
    enumName: 'intervention_action_type',
  })
  actionType!: InterventionActionType;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'uuid' })
  createdByUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'createdByUserId' })
  createdBy!: User;
}
