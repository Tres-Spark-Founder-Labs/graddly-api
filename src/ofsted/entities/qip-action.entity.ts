import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { QipActionStatus } from '../enums/qip-action-status.enum.js';

@Entity('qip_actions')
@Index('IDX_qip_actions_org_status_target', [
  'organisationId',
  'status',
  'targetCompletionDate',
])
export class QipAction extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'uuid' })
  assignedOwnerUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assignedOwnerUserId' })
  assignedOwner!: User;

  @Column({ type: 'date' })
  targetCompletionDate!: string;

  @Column({ type: 'varchar', length: 64 })
  eifCriterionSlug!: string;

  @Column({ type: 'text', nullable: true })
  evidenceNotes!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  evidenceAttachmentKeys!: string[] | null;

  @Column({
    type: 'enum',
    enum: QipActionStatus,
    enumName: 'qip_action_status',
    default: QipActionStatus.NOT_STARTED,
  })
  status!: QipActionStatus;
}
