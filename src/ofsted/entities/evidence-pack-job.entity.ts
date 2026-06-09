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

import { Organisation } from '../../organisations/entities/organisation.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { EvidencePackJobStatus } from '../enums/evidence-pack-job-status.enum.js';

@Entity('evidence_pack_jobs')
@Index('IDX_evidence_pack_jobs_org_created', ['organisationId', 'createdAt'])
export class EvidencePackJob {
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
  requestedByUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requestedByUserId' })
  requestedBy!: User;

  @Column({
    type: 'enum',
    enum: EvidencePackJobStatus,
    enumName: 'evidence_pack_job_status',
    default: EvidencePackJobStatus.QUEUED,
  })
  status!: EvidencePackJobStatus;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  outputKey!: string | null;

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  additionalStorageKeys!: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  manifest!: Record<string, unknown> | null;
}
