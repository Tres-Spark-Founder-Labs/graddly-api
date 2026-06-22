import { Column, Entity } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { RetentionRunTrigger } from '../enums/retention-run-trigger.enum.js';

@Entity('retention_run_logs')
export class RetentionRunLog extends BaseEntity {
  @Column({ type: 'timestamptz' })
  ranAt!: Date;

  @Column({
    type: 'enum',
    enum: RetentionRunTrigger,
    enumName: 'retention_run_triggered_by',
  })
  triggeredBy!: RetentionRunTrigger;

  @Column({ type: 'int' })
  auditLogsPurged!: number;

  @Column({ type: 'int' })
  softDeletedPurged!: number;

  @Column({ type: 'int' })
  oldNotificationsPurged!: number;
}
