import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CommitmentStatementGroup } from '../commitments/entities/commitment-statement-group.entity.js';
import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { CommitmentStatementStatus } from '../commitments/enums/commitment-statement-status.enum.js';
import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { MembershipStatus } from '../organisations/membership-status.enum.js';
import { OrganisationRole } from '../organisations/organisation-role.enum.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { OtjLogStatus } from '../otj/enums/otj-log-status.enum.js';
import { OtjPaceAlertLevel } from '../otj/enums/otj-pace-alert-level.enum.js';
import { computeOtjPaceSnapshot } from '../otj/otj-pace-calculator.js';
import { Standard } from '../programmes/entities/standard.entity.js';
import { Review } from '../reviews/entities/review.entity.js';
import { ReviewStatus } from '../reviews/enums/review-status.enum.js';

import { DEFAULT_GATEWAY_CRITERIA } from './constants/default-gateway-criteria.js';
import { EnrolmentsService } from './enrolments.service.js';
import { Enrolment } from './entities/enrolment.entity.js';
import { GatewayCriterionStatus } from './enums/gateway-criterion-status.enum.js';
import { JourneyMilestoneStatus } from './enums/journey-milestone-status.enum.js';

import type { EnrolmentJourneyResponseDto } from './dto/enrolment-journey-response.dto.js';
import type { UpdateEnrolmentJourneyDto } from './dto/update-enrolment-journey.dto.js';
import type { GatewayCriterionDefinition } from './types/gateway-criteria.types.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class EnrolmentJourneyService {
  constructor(
    private readonly enrolmentsService: EnrolmentsService,
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(Standard)
    private readonly standardRepo: Repository<Standard>,
    @InjectRepository(OtjLogEntry)
    private readonly otjRepo: Repository<OtjLogEntry>,
    @InjectRepository(CommitmentStatementGroup)
    private readonly commitmentGroupRepo: Repository<CommitmentStatementGroup>,
    @InjectRepository(CommitmentStatement)
    private readonly commitmentRepo: Repository<CommitmentStatement>,
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
    @InjectRepository(OrganisationMembership)
    private readonly membershipRepo: Repository<OrganisationMembership>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async getJourney(
    user: AuthenticatedUser,
    enrolmentId: string,
  ): Promise<EnrolmentJourneyResponseDto> {
    const enrolment = await this.enrolmentsService.findOne(user, enrolmentId);
    const journey = await this.buildJourney(enrolment);
    await this.maybeNotifyGatewayReady(enrolment, journey.gatewayReady);
    return journey;
  }

  /** Provider ops: gateway % without side effects (no gateway-ready notification). */
  async getGatewayCompletionPercent(enrolment: Enrolment): Promise<number> {
    const journey = await this.buildJourney(enrolment);
    return journey.gatewayCompletionPercent;
  }

  async updateJourney(
    user: AuthenticatedUser,
    enrolmentId: string,
    dto: UpdateEnrolmentJourneyDto,
  ): Promise<EnrolmentJourneyResponseDto> {
    const enrolment = await this.enrolmentsService.findOne(user, enrolmentId);
    if (dto.epaDate !== undefined) {
      enrolment.epaDate = dto.epaDate;
      await this.enrolmentRepo.save(enrolment);
    }
    return this.buildJourney(enrolment);
  }

  private async buildJourney(
    enrolment: Enrolment,
  ): Promise<EnrolmentJourneyResponseDto> {
    const organisationId = enrolment.organisationId;
    const [standard, approvedMinutes, commitmentSigned, reviewsCurrent] =
      await Promise.all([
        this.standardRepo.findOne({
          where: { id: enrolment.standardId, organisationId },
        }),
        this.sumApprovedMinutes(enrolment.id, organisationId),
        this.hasSignedCommitment(enrolment.id, organisationId),
        this.areReviewsCurrent(enrolment.id, organisationId),
      ]);

    const paceSnapshot = computeOtjPaceSnapshot({
      plannedDurationMonths: enrolment.plannedDurationMonths,
      plannedStartDate: enrolment.plannedStartDate,
      plannedEndDate: enrolment.plannedEndDate,
      activatedAt: enrolment.activatedAt,
      epaDate: enrolment.epaDate,
      approvedMinutes,
    });

    const criteriaDefs = this.resolveGatewayCriteria(standard);
    const criterionCompletion = new Map<string, boolean>([
      [
        'otj_on_track',
        paceSnapshot.alertLevel === OtjPaceAlertLevel.ON_TRACK ||
          paceSnapshot.alertLevel === OtjPaceAlertLevel.AT_RISK,
      ],
      ['commitment_signed', commitmentSigned],
      ['reviews_current', reviewsCurrent],
      ['epa_date_confirmed', enrolment.epaDate !== null],
    ]);

    const gatewayChecklist = criteriaDefs.map((criterion) =>
      this.mapCriterion(criterion, criterionCompletion),
    );
    const completeCount = gatewayChecklist.filter(
      (item) => item.status === GatewayCriterionStatus.COMPLETE,
    ).length;
    const gatewayCompletionPercent =
      criteriaDefs.length > 0
        ? Math.round((completeCount / criteriaDefs.length) * 100)
        : 0;
    const gatewayReady = gatewayCompletionPercent === 100;

    const milestones = await this.buildMilestones(
      enrolment,
      organisationId,
      gatewayReady,
    );

    return {
      enrolmentId: enrolment.id,
      epaDate: enrolment.epaDate,
      daysToEpa: this.computeDaysToEpa(enrolment.epaDate),
      epaCountdownBand: this.computeEpaCountdownBand(enrolment.epaDate),
      milestones,
      gatewayChecklist,
      gatewayCompletionPercent,
      gatewayReady,
      pace: {
        alertLevel: paceSnapshot.alertLevel,
        behindPercent: paceSnapshot.behindPercent,
        requiredWeeklyHours: paceSnapshot.requiredWeeklyHours,
        approvedMinutes: paceSnapshot.approvedMinutes,
        expectedMinutesByToday: paceSnapshot.expectedMinutesByToday,
        totalTargetMinutes: paceSnapshot.totalTargetMinutes,
      },
    };
  }

  private resolveGatewayCriteria(
    standard: Standard | null,
  ): GatewayCriterionDefinition[] {
    const raw = standard?.gatewayCriteria;
    if (Array.isArray(raw) && raw.length > 0) {
      return raw
        .map((item) => item as GatewayCriterionDefinition)
        .filter((item) => item.code && item.title);
    }
    return DEFAULT_GATEWAY_CRITERIA;
  }

  private mapCriterion(
    criterion: GatewayCriterionDefinition,
    completion: Map<string, boolean>,
  ) {
    const blockedBy =
      criterion.dependsOn?.filter((code) => !completion.get(code)) ?? [];
    if (blockedBy.length > 0) {
      return {
        code: criterion.code,
        title: criterion.title,
        description: criterion.description,
        status: GatewayCriterionStatus.BLOCKED,
        blockedBy,
      };
    }
    if (completion.get(criterion.code)) {
      return {
        code: criterion.code,
        title: criterion.title,
        description: criterion.description,
        status: GatewayCriterionStatus.COMPLETE,
      };
    }
    return {
      code: criterion.code,
      title: criterion.title,
      description: criterion.description,
      status: GatewayCriterionStatus.NOT_STARTED,
    };
  }

  private async buildMilestones(
    enrolment: Enrolment,
    organisationId: string,
    gatewayReady: boolean,
  ) {
    const reviews = await this.reviewRepo.find({
      where: { enrolmentId: enrolment.id, organisationId, isDeleted: false },
      order: { scheduledAt: 'ASC' },
    });

    const milestones = [
      this.milestone(
        'enrolment',
        'Enrolment',
        'Apprenticeship enrolment activated',
        enrolment.activatedAt
          ? enrolment.activatedAt.toISOString().slice(0, 10)
          : null,
        enrolment.activatedAt
          ? JourneyMilestoneStatus.COMPLETE
          : JourneyMilestoneStatus.UPCOMING,
      ),
      this.milestone(
        'induction',
        'Induction',
        'Programme induction completed',
        enrolment.plannedStartDate,
        enrolment.activatedAt
          ? JourneyMilestoneStatus.COMPLETE
          : JourneyMilestoneStatus.UPCOMING,
      ),
      ...reviews.map((review, index) =>
        this.milestone(
          `review_${index + 1}`,
          review.title ?? '12-weekly review',
          review.reviewType,
          review.scheduledAt.toISOString().slice(0, 10),
          review.status === ReviewStatus.COMPLETED
            ? JourneyMilestoneStatus.COMPLETE
            : review.status === ReviewStatus.CANCELLED
              ? JourneyMilestoneStatus.UPCOMING
              : JourneyMilestoneStatus.CURRENT,
        ),
      ),
      this.milestone(
        'gateway',
        'Gateway',
        'Gateway readiness checklist complete',
        gatewayReady ? new Date().toISOString().slice(0, 10) : null,
        gatewayReady
          ? JourneyMilestoneStatus.COMPLETE
          : JourneyMilestoneStatus.UPCOMING,
      ),
      this.milestone(
        'epa',
        'End-point assessment',
        'EPA window',
        enrolment.epaDate,
        enrolment.epaDate
          ? JourneyMilestoneStatus.CURRENT
          : JourneyMilestoneStatus.UPCOMING,
      ),
      this.milestone(
        'completion',
        'Completion',
        'Apprenticeship completed',
        enrolment.completedAt
          ? enrolment.completedAt.toISOString().slice(0, 10)
          : null,
        enrolment.completedAt
          ? JourneyMilestoneStatus.COMPLETE
          : JourneyMilestoneStatus.UPCOMING,
      ),
    ];

    if (!milestones.some((m) => m.status === JourneyMilestoneStatus.CURRENT)) {
      const firstUpcoming = milestones.find(
        (m) => m.status === JourneyMilestoneStatus.UPCOMING,
      );
      if (firstUpcoming) {
        firstUpcoming.status = JourneyMilestoneStatus.CURRENT;
      }
    }

    return milestones;
  }

  private milestone(
    code: string,
    title: string,
    description: string | null,
    date: string | null,
    status: JourneyMilestoneStatus,
  ) {
    return { code, title, description, date, status };
  }

  private computeDaysToEpa(epaDate: string | null): number | null {
    if (!epaDate) {
      return null;
    }
    const end = new Date(`${epaDate}T00:00:00.000Z`);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return Math.ceil((end.getTime() - today.getTime()) / MS_PER_DAY);
  }

  private computeEpaCountdownBand(
    epaDate: string | null,
  ): 'green' | 'amber' | 'red' | 'unset' {
    const days = this.computeDaysToEpa(epaDate);
    if (days === null) {
      return 'unset';
    }
    if (days > 90) {
      return 'green';
    }
    if (days >= 30) {
      return 'amber';
    }
    return 'red';
  }

  private async sumApprovedMinutes(
    enrolmentId: string,
    organisationId: string,
  ): Promise<number> {
    const row = await this.otjRepo
      .createQueryBuilder('entry')
      .select('COALESCE(SUM(entry.minutes), 0)', 'total')
      .where('entry.enrolmentId = :enrolmentId', { enrolmentId })
      .andWhere('entry.organisationId = :organisationId', { organisationId })
      .andWhere('entry.status = :status', { status: OtjLogStatus.APPROVED })
      .andWhere('entry.isDeleted = false')
      .getRawOne<{ total: string }>();
    return Number(row?.total ?? 0);
  }

  private async hasSignedCommitment(
    enrolmentId: string,
    organisationId: string,
  ): Promise<boolean> {
    const group = await this.commitmentGroupRepo.findOne({
      where: { enrolmentId, organisationId, isDeleted: false },
      relations: ['currentVersion'],
    });
    let statement = group?.currentVersion ?? null;
    if (!statement && group?.currentVersionId) {
      statement = await this.commitmentRepo.findOne({
        where: { id: group.currentVersionId },
      });
    }
    return statement?.status === CommitmentStatementStatus.SIGNED;
  }

  private async areReviewsCurrent(
    enrolmentId: string,
    organisationId: string,
  ): Promise<boolean> {
    const overdue = await this.reviewRepo
      .createQueryBuilder('review')
      .where('review.enrolmentId = :enrolmentId', { enrolmentId })
      .andWhere('review.organisationId = :organisationId', { organisationId })
      .andWhere('review.isDeleted = false')
      .andWhere('review.status NOT IN (:...done)', {
        done: [ReviewStatus.COMPLETED, ReviewStatus.CANCELLED],
      })
      .andWhere('review.scheduledAt < :now', { now: new Date() })
      .getCount();
    return overdue === 0;
  }

  private async maybeNotifyGatewayReady(
    enrolment: Enrolment,
    gatewayReady: boolean,
  ): Promise<void> {
    if (!gatewayReady || enrolment.gatewayReadyNotifiedAt) {
      return;
    }

    const providerOrgId =
      enrolment.providerOrganisationId ?? enrolment.organisationId;
    await this.notifyOrganisationAdmins(providerOrgId, enrolment.id);
    enrolment.gatewayReadyNotifiedAt = new Date();
    await this.enrolmentRepo.save(enrolment);
  }

  private async notifyOrganisationAdmins(
    organisationId: string,
    enrolmentId: string,
  ): Promise<void> {
    const owners = await this.membershipRepo.find({
      where: {
        organisation: { id: organisationId },
        isDeleted: false,
        status: MembershipStatus.ACTIVE,
        role: OrganisationRole.OWNER,
      },
      relations: ['user'],
    });
    const admins = await this.membershipRepo.find({
      where: {
        organisation: { id: organisationId },
        isDeleted: false,
        status: MembershipStatus.ACTIVE,
        role: OrganisationRole.ADMIN,
      },
      relations: ['user'],
    });

    const notified = new Set<string>();
    for (const membership of [...owners, ...admins]) {
      const userId = membership.user.id;
      if (notified.has(userId)) {
        continue;
      }
      notified.add(userId);
      await this.notificationsService.createForUser({
        userId,
        organisationId,
        type: NotificationType.GENERIC,
        title: 'Apprentice gateway ready',
        body: 'An apprentice has completed all gateway readiness criteria.',
        metadata: { enrolmentId, action: 'gateway_ready' },
      });
    }
  }
}
