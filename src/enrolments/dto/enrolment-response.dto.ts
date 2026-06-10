import { ApiProperty } from '@nestjs/swagger';

import { OtjPaceAlertLevel } from '../../otj/enums/otj-pace-alert-level.enum.js';
import { EnrolmentPipelineState } from '../enums/enrolment-pipeline-state.enum.js';
import { EnrolmentStatus } from '../enums/enrolment-status.enum.js';

export class EnrolmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organisationId!: string;

  @ApiProperty({ format: 'uuid' })
  apprenticeId!: string;

  @ApiProperty({ format: 'uuid' })
  standardId!: string;

  @ApiProperty({ enum: EnrolmentStatus })
  status!: EnrolmentStatus;

  @ApiProperty({ nullable: true })
  activatedAt!: string | null;

  @ApiProperty({ nullable: true })
  completedAt!: string | null;

  @ApiProperty({ nullable: true })
  cancelledAt!: string | null;

  @ApiProperty({ nullable: true })
  agreedPrice!: number | null;

  @ApiProperty({ nullable: true })
  plannedStartDate!: string | null;

  @ApiProperty({ nullable: true })
  plannedEndDate!: string | null;

  @ApiProperty({ nullable: true })
  plannedDurationMonths!: number | null;

  @ApiProperty({ nullable: true })
  completionPaymentPercent!: number | null;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Platform user ID linked to the apprentice',
  })
  apprenticeUserId!: string | null;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Assigned tutor platform user ID',
  })
  tutorUserId!: string | null;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Employer line manager platform user ID',
  })
  employerManagerUserId!: string | null;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Linked employer organisation for cross-portal reporting',
  })
  employerOrganisationId!: string | null;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Linked provider organisation for cross-portal reporting',
  })
  providerOrganisationId!: string | null;

  @ApiProperty({
    enum: EnrolmentPipelineState,
    nullable: true,
    description:
      'Cross-portal pipeline sub-state: invited → account_created → provider_accepted → ilr_created → das_confirmed',
    example: EnrolmentPipelineState.INVITED,
  })
  pipelineState!: EnrolmentPipelineState | null;

  @ApiProperty({
    nullable: true,
    description: 'When the apprentice invitation was sent (pipeline: invited)',
  })
  pipelineInvitedAt!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'When the apprentice portal account was linked (pipeline: account_created)',
  })
  pipelineAccountCreatedAt!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'When the provider accepted the enrolment',
  })
  pipelineProviderAcceptedAt!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'When the ILR learner record was first created',
  })
  pipelineIlrCreatedAt!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'When DAS confirmed the enrolment submission',
  })
  pipelineDasConfirmedAt!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Confirmed end-point assessment date (YYYY-MM-DD)',
  })
  epaDate!: string | null;

  @ApiProperty({
    enum: OtjPaceAlertLevel,
    nullable: true,
    description: 'Latest OTJ smart pace alert level from nightly cron',
  })
  otjPaceAlertLevel!: OtjPaceAlertLevel | null;
}
