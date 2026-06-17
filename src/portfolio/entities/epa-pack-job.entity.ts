import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Enrolment } from '../../enrolments/entities/enrolment.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { EpaPackJobStatus } from '../enums/epa-pack-job-status.enum.js';

@Entity('epa_pack_jobs')
@Index('IDX_epa_pack_jobs_org_enrolment_created', [
  'organisationId',
  'enrolmentId',
  'createdAt',
])
export class EpaPackJob {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

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

  @Column({ type: 'uuid' })
  requestedByUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requestedByUserId' })
  requestedBy!: User;

  @Column({
    type: 'enum',
    enum: EpaPackJobStatus,
    enumName: 'evidence_pack_job_status',
    default: EpaPackJobStatus.QUEUED,
  })
  status!: EpaPackJobStatus;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  outputKey!: string | null;

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  manifest!: Record<string, unknown> | null;
}
