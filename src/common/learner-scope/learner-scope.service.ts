import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Enrolment } from '../../enrolments/entities/enrolment.entity.js';
import { OrganisationRole } from '../../organisations/organisation-role.enum.js';

import type { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface.js';

/**
 * Who a learner is, and what belongs to them.
 *
 * ── WHY THIS SERVICE HAS TO EXIST ────────────────────────────────────────────
 *
 * This platform has no learner role. When an apprentice accepts their
 * invitation they are written into `organisation_memberships` as
 * `role: OrganisationRole.MEMBER` of the **provider's** organisation
 * (`invitations.service.ts:253`) — the identical row a tutor holds. Nothing on
 * `AuthenticatedUser` distinguishes the two: it is `User & { organisationId?,
 * roles? }` and that is all.
 *
 * The consequence is not a bug in one endpoint. It is that every guard in the
 * codebase which asks "is this an authenticated member of this organisation?"
 * answers *yes* for a learner, so every org-scoped query is, from a learner's
 * seat, an unscoped one. That is what survey finding 4 turned out to be.
 *
 * ── HOW A LEARNER IS IDENTIFIED ──────────────────────────────────────────────
 *
 * The only fact in the schema that says "this login is that apprentice" is
 * `enrolments.apprenticeUserId`. So a principal is treated as a learner in the
 * active organisation when BOTH hold:
 *
 *   1. they are not an owner or admin there, and
 *   2. at least one non-deleted enrolment in that organisation names them as
 *      `apprenticeUserId`.
 *
 * Condition 1 is deliberate and is the one judgment call here. A provider
 * owner who is also enrolled on a programme at their own organisation is
 * treated as staff, not as a learner. Reversing that would lock an
 * administrator out of their own portal the moment somebody enrolled them,
 * which is a worse and much more confusing failure than the (rare, and
 * internal) case of an admin seeing a cohort they were always able to see.
 * Recorded rather than assumed — see AUDIT.md.
 *
 * ── WHY THE RESULT IS MEMOISED ON THE REQUEST ────────────────────────────────
 *
 * The interceptor asks once per request, and then every service that filters
 * rows asks again. Without memoisation that is one extra query per call site
 * on the hottest read paths in the apprentice portal. `AuthenticatedUser` is
 * constructed fresh per request by `JwtStrategy`, so hanging a cache off it is
 * request-local by construction — it cannot leak between requests the way a
 * service-level Map keyed on user id could.
 */
export interface ILearnerScope {
  /** True when this principal is a learner in the active organisation. */
  isLearner: boolean;
  /** Enrolments this learner owns. Empty for non-learners. */
  enrolmentIds: string[];
  /** Apprentice records behind those enrolments. Empty for non-learners. */
  apprenticeIds: string[];
}

const NOT_A_LEARNER: ILearnerScope = Object.freeze({
  isLearner: false,
  enrolmentIds: [],
  apprenticeIds: [],
});

/** Request-local memo slot. A symbol so it cannot collide with a User column. */
const SCOPE_CACHE = Symbol.for('graddly.learnerScope');

type Memoised = AuthenticatedUser & {
  [SCOPE_CACHE]?: Map<string, ILearnerScope>;
};

@Injectable()
export class LearnerScopeService {
  constructor(
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
  ) {}

  async resolve(user: AuthenticatedUser): Promise<ILearnerScope> {
    const organisationId = user.organisationId;
    if (!organisationId || !user.id) {
      // No active organisation means no organisation-scoped read to protect.
      // The routes in that position are `/auth/*`, which are scoped by the
      // principal by construction.
      return NOT_A_LEARNER;
    }

    const memo = (user as Memoised)[SCOPE_CACHE];
    const cached = memo?.get(organisationId);
    if (cached) {
      return cached;
    }

    const scope = await this.load(user, organisationId);

    const store = memo ?? new Map<string, ILearnerScope>();
    store.set(organisationId, scope);
    (user as Memoised)[SCOPE_CACHE] = store;

    return scope;
  }

  /**
   * The enrolment ids a query must be narrowed to, or `null` for "do not
   * narrow".
   *
   * Returning `null` rather than an empty array for staff is the important
   * part: an empty array in a call site that does `IN (:...ids)` would silently
   * return nothing, so the two states have to be distinguishable. Same
   * unknown-versus-zero discipline applied elsewhere in this codebase.
   */
  async ownEnrolmentIds(user: AuthenticatedUser): Promise<string[] | null> {
    const scope = await this.resolve(user);
    return scope.isLearner ? scope.enrolmentIds : null;
  }

  /** As {@link ownEnrolmentIds}, for tables keyed by `apprenticeId`. */
  async ownApprenticeIds(user: AuthenticatedUser): Promise<string[] | null> {
    const scope = await this.resolve(user);
    return scope.isLearner ? scope.apprenticeIds : null;
  }

  private async load(
    user: AuthenticatedUser,
    organisationId: string,
  ): Promise<ILearnerScope> {
    const roles = user.roles ?? [];
    if (
      roles.includes(OrganisationRole.OWNER) ||
      roles.includes(OrganisationRole.ADMIN)
    ) {
      return NOT_A_LEARNER;
    }

    const linked = await this.enrolmentRepo.find({
      where: {
        organisationId,
        apprenticeUserId: user.id,
        isDeleted: false,
      },
      select: ['id', 'apprenticeId'],
    });

    /**
     * The fail-open this closes.
     *
     * `apprenticeUserId` is stamped when an apprentice accepts their
     * invitation (`enrolment-provisioning.service.ts:71`). If that stamp is
     * ever missing — provisioning half-completed, an enrolment relinked, a row
     * repaired by hand — the principal above resolves as *staff*, and a
     * fail-open on an authorisation boundary is the worst possible default.
     *
     * So membership origin is consulted as well: an apprentice is invited with
     * `invitations.enrolmentId` set (`invitations.service.ts:254`), and staff
     * never are. A member holding an apprentice-origin invitation is a learner
     * whether or not the enrolment stamp survived.
     */
    const invited = await this.enrolmentRepo
      .createQueryBuilder('e')
      .innerJoin('invitations', 'i', 'i."enrolmentId" = e.id')
      .where('e."organisationId" = :organisationId', { organisationId })
      .andWhere('e."isDeleted" = false')
      .andWhere('i."organisationId" = :organisationId')
      .andWhere('LOWER(i.email) = LOWER(:email)', { email: user.email ?? '' })
      .select(['e.id', 'e.apprenticeId'])
      .getMany();

    const rows = [...linked, ...invited];
    if (rows.length === 0) {
      return NOT_A_LEARNER;
    }

    return {
      isLearner: true,
      enrolmentIds: [...new Set(rows.map((row) => row.id))],
      apprenticeIds: [...new Set(rows.map((row) => row.apprenticeId))],
    };
  }
}
