import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { OtjPaceAlertLevel } from '../../otj/enums/otj-pace-alert-level.enum.js';
import { GatewayCriterionStatus } from '../enums/gateway-criterion-status.enum.js';
import { JourneyMilestoneStatus } from '../enums/journey-milestone-status.enum.js';

export class JourneyMilestoneDto {
  @ApiProperty({ example: 'enrolment' })
  code!: string;

  @ApiProperty({ example: 'Enrolment activated' })
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  description!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2025-01-15' })
  date!: string | null;

  @ApiProperty({ enum: JourneyMilestoneStatus })
  status!: JourneyMilestoneStatus;
}

export class GatewayChecklistItemDto {
  @ApiProperty({ example: 'otj_on_track' })
  code!: string;

  @ApiProperty({ example: 'OTJ hours on track' })
  title!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ enum: GatewayCriterionStatus })
  status!: GatewayCriterionStatus;

  @ApiPropertyOptional({
    type: [String],
    description: 'Upstream criterion codes blocking progress',
  })
  blockedBy?: string[];
}

export class EnrolmentJourneyPaceDto {
  @ApiPropertyOptional({ enum: OtjPaceAlertLevel, nullable: true })
  alertLevel!: OtjPaceAlertLevel | null;

  @ApiPropertyOptional({ nullable: true })
  behindPercent!: number | null;

  @ApiPropertyOptional({ nullable: true })
  requiredWeeklyHours!: number | null;

  @ApiProperty()
  approvedMinutes!: number;

  @ApiProperty()
  expectedMinutesByToday!: number;

  @ApiProperty()
  totalTargetMinutes!: number;
}

export class EnrolmentJourneyResponseDto {
  @ApiProperty({ format: 'uuid' })
  enrolmentId!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'EPA date (YYYY-MM-DD) or null when not yet confirmed',
  })
  epaDate!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Days remaining until EPA; null when EPA date unset',
  })
  daysToEpa!: number | null;

  @ApiProperty({
    description: 'EPA countdown colour band: green / amber / red / unset',
    example: 'amber',
  })
  epaCountdownBand!: 'green' | 'amber' | 'red' | 'unset';

  @ApiProperty({ type: [JourneyMilestoneDto] })
  milestones!: JourneyMilestoneDto[];

  @ApiProperty({ type: [GatewayChecklistItemDto] })
  gatewayChecklist!: GatewayChecklistItemDto[];

  @ApiProperty({ description: 'Gateway checklist completion 0–100' })
  gatewayCompletionPercent!: number;

  @ApiProperty()
  gatewayReady!: boolean;

  @ApiProperty({ type: EnrolmentJourneyPaceDto })
  pace!: EnrolmentJourneyPaceDto;
}
