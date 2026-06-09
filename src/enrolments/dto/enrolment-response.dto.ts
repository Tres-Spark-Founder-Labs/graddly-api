import { ApiProperty } from '@nestjs/swagger';

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
}
