import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { CommitmentPipelineStatus } from '../enums/commitment-pipeline-status.enum.js';

export class EmployerDirectoryEntryResponseDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Employer organisation id linked on provider enrolments',
  })
  employerOrganisationId!: string;

  @ApiProperty({ example: 'Acme Engineering Ltd' })
  organisationName!: string;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Jane Smith',
    description: 'Owner membership name or null when unavailable',
  })
  contactName!: string | null;

  @ApiProperty({
    example: 'hr@acme-engineering.co.uk',
    description: 'Owner email or organisation orgEmail',
  })
  contactEmail!: string;

  @ApiProperty({ example: 5 })
  activeLearnerCount!: number;

  @ApiProperty({
    nullable: true,
    example: 68.25,
    description: 'Average OTJ % across active learners for this employer',
  })
  averageOtjPercent!: number | null;

  @ApiProperty({
    enum: CommitmentPipelineStatus,
    description:
      'Most advanced commitment pipeline among active enrolments (F2.4.1)',
  })
  commitmentPipelineStatus!: CommitmentPipelineStatus;

  @ApiProperty({
    nullable: true,
    description: 'Reserved for employer visit log (F2.4.2)',
    example: null,
  })
  lastVisitDate!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'London',
    description: 'Employer city used as region filter',
  })
  region!: string | null;
}
