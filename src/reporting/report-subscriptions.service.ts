import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { MembershipStatus } from '../organisations/membership-status.enum.js';
import { User } from '../users/entities/user.entity.js';

import { ReportSubscription } from './entities/report-subscription.entity.js';
import { ReportSubscriptionType } from './enums/report-subscription-type.enum.js';

import type { ReportSubscriberDto } from './dto/report-subscription.dto.js';

/**
 * F1.4.1 AC5 — who receives the scheduled monthly ROI report.
 *
 * Recipients must be active members of the organisation. That is not a
 * formality: the report carries apprentice counts, completion rates,
 * withdrawal rates and levy spend, and emailing it to an arbitrary address
 * because somebody typed it into a box is a data-protection incident waiting
 * for a typo. It also matches the ruling already made for the OTJ digest
 * (decision 5).
 */
@Injectable()
export class ReportSubscriptionsService {
  constructor(
    @InjectRepository(ReportSubscription)
    private readonly subscriptionRepo: Repository<ReportSubscription>,
    @InjectRepository(OrganisationMembership)
    private readonly membershipRepo: Repository<OrganisationMembership>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async list(
    organisationId: string,
    reportType: ReportSubscriptionType = ReportSubscriptionType.LEVY_ROI_MONTHLY,
  ): Promise<ReportSubscriberDto[]> {
    const subscriptions = await this.subscriptionRepo.find({
      where: { organisationId, reportType, isDeleted: false, enabled: true },
    });
    if (subscriptions.length === 0) {
      return [];
    }

    const users = await this.userRepo.findBy({
      id: In(subscriptions.map((s) => s.userId)),
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return subscriptions
      .map((subscription) => {
        const user = userMap.get(subscription.userId);
        if (!user) return null;
        return {
          userId: user.id,
          name: [user.firstName, user.lastName].filter(Boolean).join(' '),
          email: user.email,
          lastSentAt: subscription.lastSentAt?.toISOString() ?? null,
        };
      })
      .filter((row): row is ReportSubscriberDto => row !== null);
  }

  /**
   * Replaces the whole list.
   *
   * Removals are soft-deleted rather than hard-deleted so `lastSentAt`
   * survives — "when did this person last receive the board report" is a
   * question that outlives their place on the list.
   */
  async replace(
    organisationId: string,
    userIds: string[],
    addedByUserId: string,
    reportType: ReportSubscriptionType = ReportSubscriptionType.LEVY_ROI_MONTHLY,
  ): Promise<ReportSubscriberDto[]> {
    const unique = [...new Set(userIds)];

    if (unique.length > 0) {
      // `organisation_memberships` exposes relations rather than scalar
      // `userId`/`organisationId` columns, so this filters through them.
      const memberships = await this.membershipRepo.find({
        where: {
          organisation: { id: organisationId },
          user: { id: In(unique) },
          status: MembershipStatus.ACTIVE,
          isDeleted: false,
        },
        relations: ['user'],
      });
      const memberIds = new Set(memberships.map((m) => m.user.id));
      const outsiders = unique.filter((id) => !memberIds.has(id));
      if (outsiders.length > 0) {
        throw new BadRequestException(
          `Not active members of this organisation: ${outsiders.join(', ')}`,
        );
      }
    }

    const existing = await this.subscriptionRepo.find({
      where: { organisationId, reportType, isDeleted: false },
    });
    const existingByUser = new Map(existing.map((s) => [s.userId, s]));

    for (const subscription of existing) {
      const stillListed = unique.includes(subscription.userId);
      if (subscription.enabled !== stillListed) {
        subscription.enabled = stillListed;
        await this.subscriptionRepo.save(subscription);
      }
    }

    const toCreate = unique.filter((id) => !existingByUser.has(id));
    if (toCreate.length > 0) {
      await this.subscriptionRepo.save(
        toCreate.map((userId) =>
          this.subscriptionRepo.create({
            organisationId,
            userId,
            reportType,
            enabled: true,
            addedByUserId,
          }),
        ),
      );
    }

    return this.list(organisationId, reportType);
  }

  /** Enabled subscriptions across every organisation, for the monthly cron. */
  async listAllEnabled(
    reportType: ReportSubscriptionType = ReportSubscriptionType.LEVY_ROI_MONTHLY,
  ): Promise<ReportSubscription[]> {
    return this.subscriptionRepo.find({
      where: { reportType, enabled: true, isDeleted: false },
    });
  }

  async markSent(subscriptionIds: string[], sentAt: Date): Promise<void> {
    if (subscriptionIds.length === 0) return;
    await this.subscriptionRepo
      .createQueryBuilder()
      .update(ReportSubscription)
      .set({ lastSentAt: sentAt })
      .where('id IN (:...ids)', { ids: subscriptionIds })
      .execute();
  }
}
