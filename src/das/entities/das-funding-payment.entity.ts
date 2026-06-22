import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { Enrolment } from '../../enrolments/entities/enrolment.entity.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';

@Entity('das_funding_payments')
@Index(
  'UQ_das_funding_payments_org_external_ref',
  ['organisationId', 'externalReference'],
  {
    unique: true,
    where: `"isDeleted" = false`,
  },
)
export class DasFundingPayment extends BaseEntity {
  @Column({ type: 'uuid' })
  organisationId!: string;

  @ManyToOne(() => Organisation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organisationId' })
  organisation!: Organisation;

  @Column({ type: 'uuid', nullable: true })
  enrolmentId!: string | null;

  @ManyToOne(() => Enrolment, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'enrolmentId' })
  enrolment!: Enrolment | null;

  @Column({ type: 'date' })
  paymentDate!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount!: string;

  @Column({ type: 'varchar', length: 3, default: 'GBP' })
  currency!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  fundingPeriod!: string | null;

  @Column({ type: 'text', nullable: true })
  clawbackNotice!: string | null;

  @Column({ type: 'varchar', length: 128 })
  externalReference!: string;

  @Column({ type: 'jsonb', nullable: true })
  rawPayload!: Record<string, unknown> | null;

  @Column({ type: 'timestamptz' })
  lastSyncedAt!: Date;
}
