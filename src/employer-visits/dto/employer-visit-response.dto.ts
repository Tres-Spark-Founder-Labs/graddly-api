import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { EmployerVisitType } from '../enums/employer-visit-type.enum.js';

export class EmployerVisitLearnerDto {
  @ApiProperty({ format: 'uuid' })
  enrolmentId!: string;

  @ApiProperty()
  apprenticeName!: string;
}

export class EmployerVisitResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  employerOrganisationId!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  employerName!: string | null;

  @ApiProperty({ type: String, format: 'date' })
  visitedOn!: string;

  @ApiProperty({ enum: EmployerVisitType })
  visitType!: EmployerVisitType;

  @ApiProperty()
  attendees!: string;

  @ApiProperty()
  discussionPoints!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  actionPoints!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  nextVisitDate!: string | null;

  @ApiProperty({
    type: [EmployerVisitLearnerDto],
    description: 'AC2 — the learners discussed at this visit.',
  })
  learners!: EmployerVisitLearnerDto[];

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  recordedByUserId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** F2.4.2 AC4 — what the form should offer for the next visit. */
export class NextVisitSuggestionResponseDto {
  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: true,
    description: 'Null when this employer has never been visited.',
  })
  lastVisitedOn!: string | null;

  @ApiProperty({
    type: String,
    format: 'date',
    description:
      'Counted from the last visit, not from today — a visit recorded late ' +
      'should not push the whole schedule back by the delay.',
  })
  suggestedDate!: string;

  @ApiProperty({ description: 'Weeks between visits this suggestion assumes.' })
  intervalWeeks!: number;
}
