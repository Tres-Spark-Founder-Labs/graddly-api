import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { buildPaginationMeta } from '../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';

import { CreateNotificationDto } from './dto/create-notification.dto.js';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto.js';
import { NotificationResponseDto } from './dto/notification-response.dto.js';
import { Notification } from './entities/notification.entity.js';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
  ) {}

  async listForUser(
    userId: string,
    query: ListNotificationsQueryDto,
    activeOrganisationId?: string | null,
  ): Promise<PaginatedResult<NotificationResponseDto>> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const organisationId =
      query.organisationId ?? activeOrganisationId ?? undefined;

    const qb = this.notificationRepo
      .createQueryBuilder('n')
      .where('n.userId = :userId', { userId })
      .andWhere('n.isDeleted = false');

    if (organisationId) {
      qb.andWhere('n.organisationId = :organisationId', { organisationId });
    }

    if (query.unreadOnly) {
      qb.andWhere('n.readAt IS NULL');
    }

    qb.orderBy('n.createdAt', 'DESC')
      .skip((page - 1) * perPage)
      .take(perPage);

    const [rows, total] = await qb.getManyAndCount();

    return new PaginatedResult(
      rows.map((row) => this.toResponse(row)),
      buildPaginationMeta({ total, page, perPage }),
    );
  }

  async markRead(userId: string, id: string): Promise<NotificationResponseDto> {
    const notification = await this.notificationRepo.findOne({
      where: { id, user: { id: userId }, isDeleted: false },
    });
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (!notification.readAt) {
      notification.readAt = new Date();
      await this.notificationRepo.save(notification);
    }

    return this.toResponse(notification);
  }

  async markAllRead(
    userId: string,
    organisationId?: string,
  ): Promise<{ updated: number }> {
    const qb = this.notificationRepo
      .createQueryBuilder()
      .update(Notification)
      .set({ readAt: () => 'NOW()' })
      .where('"userId" = :userId', { userId })
      .andWhere('"isDeleted" = false')
      .andWhere('"readAt" IS NULL');

    if (organisationId) {
      qb.andWhere('"organisationId" = :organisationId', { organisationId });
    }

    const result = await qb.execute();
    return { updated: result.affected ?? 0 };
  }

  /**
   * Returns `null` when the recipient is not yet a member of the organisation.
   * That is a normal pre-membership state under PRD F1.2.5 AC1/AC3/AC5, not a
   * failure — see the comment on the catch below.
   */
  async createForUser(
    dto: CreateNotificationDto,
  ): Promise<NotificationResponseDto | null> {
    /**
     * `organisationId` is required since migration 1781100000051.
     * `notifications_insert` is keyed on it, so an absent value produces a NULL
     * comparison, the WITH CHECK fails closed, and the caller gets an opaque
     * 42501. Failing here instead names the actual problem at the call site.
     *
     * Every one of the 18 existing callers already supplies it; this guards new
     * ones.
     */
    if (!dto.organisationId) {
      throw new BadRequestException(
        'A notification must carry an organisationId — it is what the ' +
          'row-level security policy is keyed on.',
      );
    }

    /**
     * Written through `app_create_notification` rather than `repo.save()`.
     *
     * A notification is by definition addressed to somebody other than the
     * actor, and both halves of an ORM save are refused for that: the INSERT by
     * `notifications_insert`, and — less obviously — the `RETURNING` clause
     * TypeORM appends, which is a *read* of the new row and so is judged by
     * `notifications_select` (`"userId" = app_current_user()`). That second
     * half is why re-keying the insert policy alone did not fix this.
     *
     * The function is `SECURITY DEFINER`, so neither policy applies inside it,
     * and it enforces its own rule instead: the recipient must be an active
     * member of the organisation. `notifications_select` is left untouched, so
     * the read path stays exactly as tight as it was.
     *
     * See migration 1781100000052.
     */
    let rows: Notification[];
    try {
      rows = await this.notificationRepo.manager.query(
        `SELECT * FROM app_create_notification($1, $2, $3, $4, $5, $6::jsonb)`,
        [
          dto.userId,
          dto.organisationId,
          dto.type,
          dto.title,
          dto.body,
          dto.metadata ? JSON.stringify(dto.metadata) : null,
        ],
      );
    } catch (error) {
      /**
       * "Recipient is not a member yet" is a normal state, not a failure.
       *
       * PRD F1.2.5 models the gap deliberately: AC1 has the employer create the
       * apprentice's profile, AC3 then invites them to create a portal account,
       * and AC5 tracks *invited* and *account created* as distinct states —
       * both of which precede organisation membership. So an enrolment can
       * legitimately name a `apprenticeUserId` who cannot yet receive anything.
       *
       * This is the same reasoning `otj-log-entries.service.ts` already applies
       * one step earlier: "Enrolments can exist before the apprentice has a
       * portal login. There is no one to notify, which is not an error." A user
       * can equally have a login and not yet be a member.
       *
       * Returning `null` rather than throwing lets every caller that ignores
       * the result skip quietly and unchanged, which is most of them.
       */
      if (isRecipientNotYetMemberError(error)) {
        return null;
      }

      /**
       * Everything else stays loud, deliberately. An RLS violation, a
       * constraint violation or a dropped connection are all real defects, and
       * swallowing them here would recreate exactly the silence that hid this
       * bug for months.
       */
      throw error;
    }

    const saved = rows[0];
    if (!saved) {
      throw new BadRequestException('Notification could not be created');
    }

    return this.toResponse(saved);
  }

  private toResponse(notification: Notification): NotificationResponseDto {
    return {
      id: notification.id,
      userId: notification.userId,
      organisationId: notification.organisationId,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      readAt: notification.readAt,
      metadata: notification.metadata,
      createdAt: notification.createdAt,
      updatedAt: notification.updatedAt,
    };
  }
}

/**
 * Distinguishes the function's own membership refusal from a genuine 42501.
 *
 * `app_create_notification` raises SQLSTATE 42501 for "recipient is not a
 * member", and Postgres uses the same code for a row-level-security violation.
 * The code alone is therefore ambiguous, so the message is matched too — a real
 * RLS refusal reads "new row violates row-level security policy".
 *
 * Matching our own `RAISE EXCEPTION` text is a little brittle, and it is the
 * narrower risk: the alternative is treating every 42501 as benign, which would
 * re-hide the class of defect this whole change exists to surface.
 */
function isRecipientNotYetMemberError(error: unknown): boolean {
  const e = error as {
    code?: string;
    message?: string;
    driverError?: { code?: string; message?: string };
  };
  const code = e?.code ?? e?.driverError?.code;
  const message = e?.message ?? e?.driverError?.message ?? '';
  return (
    code === '42501' && /is not an active member of organisation/i.test(message)
  );
}
