import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';

import { EmailDispatchService } from '../../email/email-dispatch.service.js';
import { EmailTemplate } from '../../email/email-template.enum.js';
import { SerializedEmailPayload } from '../../email/payloads/serialized-email.payload.js';
import { NotificationType } from '../../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { OrganisationMembership } from '../../organisations/entities/organisation-membership.entity.js';
import { MembershipStatus } from '../../organisations/membership-status.enum.js';
import { OrganisationRole } from '../../organisations/organisation-role.enum.js';
import { DasLevyTranche } from '../entities/das-levy-tranche.entity.js';
import { LevyExpiryAlertDispatch } from '../entities/levy-expiry-alert-dispatch.entity.js';
import { DasDonorLinkStatus } from '../enums/das-donor-link-status.enum.js';
import { LevyExpiryAlertType } from '../enums/levy-expiry-alert-type.enum.js';

@Injectable()
export class LevyExpiryAlertService {
  private readonly logger = new Logger(LevyExpiryAlertService.name);

  constructor(
    @InjectRepository(DasLevyTranche)
    private readonly trancheRepo: Repository<DasLevyTranche>,
    @InjectRepository(LevyExpiryAlertDispatch)
    private readonly dispatchRepo: Repository<LevyExpiryAlertDispatch>,
    @InjectRepository(OrganisationMembership)
    private readonly membershipRepo: Repository<OrganisationMembership>,
    private readonly notificationsService: NotificationsService,
    private readonly emailDispatchService: EmailDispatchService,
    private readonly config: ConfigService,
  ) {}

  async sendDueAlerts(): Promise<number> {
    let sent = 0;
    sent += await this.sendForWindow(LevyExpiryAlertType.DAYS_90, 90);
    sent += await this.sendForWindow(LevyExpiryAlertType.DAYS_30, 30);
    return sent;
  }

  private async sendForWindow(
    alertType: LevyExpiryAlertType,
    daysAhead: number,
  ): Promise<number> {
    const targetDay = this.utcDateOnly(new Date());
    targetDay.setUTCDate(targetDay.getUTCDate() + daysAhead);
    const dayStart = new Date(targetDay);
    const dayEnd = new Date(targetDay);
    dayEnd.setUTCHours(23, 59, 59, 999);

    const tranches = await this.trancheRepo.find({
      where: {
        isDeleted: false,
        expiresOn: Between(
          dayStart.toISOString().slice(0, 10),
          dayEnd.toISOString().slice(0, 10),
        ),
      },
      relations: { donorLink: true },
    });

    let sent = 0;
    for (const tranche of tranches) {
      if (tranche.donorLink?.status !== DasDonorLinkStatus.LINKED) {
        continue;
      }

      const existing = await this.dispatchRepo.findOne({
        where: { trancheId: tranche.id, alertType },
      });
      if (existing) {
        continue;
      }

      try {
        await this.notifyOrganisation(
          tranche.organisationId,
          tranche,
          alertType,
          daysAhead,
        );
        await this.dispatchRepo.save(
          this.dispatchRepo.create({
            organisationId: tranche.organisationId,
            donorLinkId: tranche.donorLinkId,
            trancheId: tranche.id,
            alertType,
            sentAt: new Date(),
          }),
        );
        sent++;
      } catch (error) {
        this.logger.warn(
          `Failed levy expiry alert ${alertType} for tranche ${tranche.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return sent;
  }

  private async notifyOrganisation(
    organisationId: string,
    tranche: DasLevyTranche,
    alertType: LevyExpiryAlertType,
    daysAhead: number,
  ): Promise<void> {
    const recipients = await this.membershipRepo.find({
      where: {
        organisation: { id: organisationId },
        role: In([OrganisationRole.OWNER, OrganisationRole.ADMIN]),
        status: MembershipStatus.ACTIVE,
        isDeleted: false,
      },
      relations: { user: true },
    });

    const notificationType =
      alertType === LevyExpiryAlertType.DAYS_90
        ? NotificationType.LEVY_EXPIRY_90
        : NotificationType.LEVY_EXPIRY_30;
    const emailTemplate =
      alertType === LevyExpiryAlertType.DAYS_90
        ? EmailTemplate.LEVY_EXPIRY_90
        : EmailTemplate.LEVY_EXPIRY_30;
    const transferCtaUrl = this.resolveTransferCtaUrl();
    const appName = this.config.get<string>('app.email.appName', 'Graddly');
    const donorLabel =
      tranche.donorLink?.label ??
      tranche.donorLink?.ukprn ??
      'your DAS account';

    for (const membership of recipients) {
      const user = membership.user;
      if (!user) {
        continue;
      }

      await this.notificationsService.createForUser({
        userId: user.id,
        organisationId,
        type: notificationType,
        title: `Levy expiry alert (${daysAhead} days)`,
        body: `${tranche.amount} from ${donorLabel} expires on ${tranche.expiresOn}.`,
        metadata: {
          trancheId: tranche.id,
          donorLinkId: tranche.donorLinkId,
          alertType,
          expiresOn: tranche.expiresOn,
          amount: tranche.amount,
        },
      });

      if (user.email) {
        await this.emailDispatchService.enqueue(
          new SerializedEmailPayload(emailTemplate, user.email, {
            firstName: user.firstName,
            trancheAmount: tranche.amount,
            expiresOn: tranche.expiresOn,
            daysAhead,
            appName,
            transferCtaUrl,
          }),
        );
      }
    }
  }

  private resolveTransferCtaUrl(): string {
    const base = this.config
      .get<string>('app.frontend.portalUrls.flow', '')
      ?.trim();
    if (!base) {
      return '#';
    }
    return `${base.replace(/\/$/, '')}/levy-exchange/transfers`;
  }

  private utcDateOnly(date: Date): Date {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }
}
