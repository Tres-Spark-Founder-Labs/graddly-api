import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { OtjPaceAlertLevel } from '../../otj/enums/otj-pace-alert-level.enum.js';
import { OtjProgressBand } from '../../otj/enums/otj-progress-band.enum.js';
import { EpaCountdownBand } from '../enums/epa-countdown-band.enum.js';
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

  /**
   * F3.1.2 AC1 — approved minutes as a percentage of the total target. Null
   * when no target could be computed, which is not the same as zero.
   */
  @ApiPropertyOptional({ nullable: true, example: 62.5 })
  percentOfTarget!: number | null;

  /**
   * F3.1.2 AC2 — the progress ring's colour band, evaluated server-side.
   *
   * Published as a band rather than left to the client so the 70/50 thresholds
   * exist in one place. The EPA countdown carried the same rule in two places
   * once, and day 90 landed in the wrong band for months.
   */
  @ApiProperty({
    enum: OtjProgressBand,
    description:
      'Progress ring band. green ≥70% of target, amber 50–69%, red <50%, ' +
      'unknown when no target could be computed.',
    example: OtjProgressBand.AMBER,
  })
  progressBand!: OtjProgressBand;

  /**
   * F3.1.2 AC5 — projected completion date at the learner's *observed* logging
   * pace. Null when it cannot be projected honestly: nothing approved yet, the
   * programme not started, or the target already met.
   */
  @ApiPropertyOptional({
    nullable: true,
    format: 'date',
    description:
      'Projected date the OTJ target is met at current pace; null when it ' +
      'cannot be projected',
  })
  projectedCompletionDate!: string | null;
}

export class EnrolmentJourneyResponseDto {
  @ApiProperty({ format: 'uuid' })
  enrolmentId!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'EPA date (YYYY-MM-DD) or null when not yet confirmed',
  })
  epaDate!: string | null;

  /**
   * F2.2.4 AC1. `PATCH /enrolments/:id/journey` accepts these two and saves
   * them, so the response has to show them back — an endpoint that swallows
   * what it was given and returns a body without it reads as a failed write.
   */
  @ApiPropertyOptional({
    nullable: true,
    description: 'End-point assessment organisation name; null until appointed',
  })
  epaOrganisationName!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'EPAO UKPRN (8 digits) as it appears on the ILR',
  })
  epaOrganisationUkprn!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Days remaining until EPA; null when EPA date unset',
  })
  daysToEpa!: number | null;

  /**
   * F3.2.3 AC2 and client decision Q4. `daysToEpa` stays truthful and goes
   * negative once the date has passed; the band is what the client switches
   * on. `overdue` exists so a passed EPA date with no completion recorded is
   * not rendered as a countdown running backwards.
   */
  @ApiProperty({
    enum: EpaCountdownBand,
    description:
      'EPA countdown colour band. green ≥90 days, amber 30–89, red ≤29 ' +
      '(including the day itself), overdue once the date has passed with no ' +
      'completion recorded, unset when the provider has not confirmed a date.',
    example: EpaCountdownBand.AMBER,
  })
  epaCountdownBand!: EpaCountdownBand;

  @ApiProperty({ type: [JourneyMilestoneDto] })
  milestones!: JourneyMilestoneDto[];

  @ApiProperty({ type: [GatewayChecklistItemDto] })
  gatewayChecklist!: GatewayChecklistItemDto[];

  @ApiProperty({ description: 'Gateway checklist completion 0–100' })
  gatewayCompletionPercent!: number;

  @ApiProperty()
  gatewayReady!: boolean;

  /**
   * Client decision Q3 — the recorded moment readiness was reached, so "when
   * did this apprentice become ready" can be answered later. Null whenever
   * `gatewayReady` is false, including after a lapse: this describes the
   * current readiness, not the high-water mark.
   */
  @ApiPropertyOptional({
    nullable: true,
    format: 'date-time',
    description:
      'When gateway readiness was reached; null when not currently ready',
  })
  gatewayReadyAt!: Date | null;

  @ApiProperty({ type: EnrolmentJourneyPaceDto })
  pace!: EnrolmentJourneyPaceDto;
}
