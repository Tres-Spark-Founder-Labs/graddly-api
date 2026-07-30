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

  @ApiProperty({
    nullable: true,
    example: 'Jane Smith',
    description:
      'Name from the provider apprentice record (available on list/detail for all portals)',
  })
  apprenticeDisplayName!: string | null;

  @ApiProperty({
    nullable: true,
    example: 'Software Developer (ST0123)',
    description: 'Standard title and code for display',
  })
  standardDisplayName!: string | null;

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
    nullable: true,
    example: 'Jane Smith (jane.smith@example.com)',
    description: 'Display label for linked apprentice platform user',
  })
  apprenticeUserDisplayName!: string | null;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Assigned tutor platform user ID',
  })
  tutorUserId!: string | null;

  @ApiProperty({
    nullable: true,
    example: 'Alex Jones (alex@provider.example.com)',
    description: 'Display label for assigned tutor',
  })
  tutorUserDisplayName!: string | null;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Employer line manager platform user ID',
  })
  employerManagerUserId!: string | null;

  @ApiProperty({
    nullable: true,
    example: 'Sam Taylor (sam@employer.example.com)',
    description: 'Display label for employer line manager',
  })
  employerManagerUserDisplayName!: string | null;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Linked employer organisation for cross-portal reporting',
  })
  employerOrganisationId!: string | null;

  @ApiProperty({
    nullable: true,
    example: 'Acme Engineering Ltd',
    description: 'Display name for linked employer organisation',
  })
  employerOrganisationName!: string | null;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Linked provider organisation for cross-portal reporting',
  })
  providerOrganisationId!: string | null;

  @ApiProperty({
    nullable: true,
    example: 'Northstar Training Ltd',
    description: 'Display name for linked provider organisation',
  })
  providerOrganisationName!: string | null;

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

  @ApiProperty({
    nullable: true,
    type: Number,
    description:
      'How far behind the required OTJ pace, as a percentage (F1.2.4 AC5). ' +
      'Null when pace cannot be computed, which is not the same as zero.',
  })
  otjBehindPercent!: number | null;
}
