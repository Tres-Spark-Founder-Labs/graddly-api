import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity.js';
import { RegistrationSessionStatus } from '../enums/registration-session-status.enum.js';
import { RegistrationWizardStep } from '../enums/registration-wizard-step.enum.js';

export type RegistrationStepPayload = Partial<
  Record<RegistrationWizardStep, Record<string, unknown>>
>;

@Entity('flowportal_registration_sessions')
export class FlowportalRegistrationSession extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  resumeTokenHash!: string;

  @Column({
    type: 'enum',
    enum: RegistrationSessionStatus,
    default: RegistrationSessionStatus.IN_PROGRESS,
  })
  status!: RegistrationSessionStatus;

  @Column({
    type: 'enum',
    enum: RegistrationWizardStep,
    default: RegistrationWizardStep.COMPANY_VERIFICATION,
  })
  currentStep!: RegistrationWizardStep;

  @Column({ type: 'varchar', length: 320, nullable: true })
  contactEmail!: string | null;

  @Column({ type: 'jsonb', default: {} })
  stepPayload!: RegistrationStepPayload;

  @Column({ type: 'varchar', length: 20, nullable: true })
  companiesHouseNumber!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  companyName!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  payeReference!: string | null;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
}
