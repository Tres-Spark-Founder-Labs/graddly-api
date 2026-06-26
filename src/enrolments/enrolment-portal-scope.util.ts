import { FindOptionsWhere } from 'typeorm';

import { PortalType } from '../organisations/portal-type.enum.js';

import { Enrolment } from './entities/enrolment.entity.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

/** Resolves portal context: explicit header wins, else active org portalType, else provider. */
export function resolveEnrolmentPortalType(
  headerPortalType: PortalType | undefined,
  organisationPortalType: PortalType | null | undefined,
): PortalType {
  return headerPortalType ?? organisationPortalType ?? PortalType.PROVIDER;
}

/** TypeORM where clause for portal-scoped enrolment list/detail reads. */
export function buildEnrolmentListWhere(
  user: AuthenticatedUser,
  portalType: PortalType,
): FindOptionsWhere<Enrolment> {
  const orgId = user.organisationId!;
  const base: FindOptionsWhere<Enrolment> = { isDeleted: false };

  switch (portalType) {
    case PortalType.EMPLOYER:
      return { ...base, employerOrganisationId: orgId };
    case PortalType.APPRENTICE:
      return { ...base, organisationId: orgId, apprenticeUserId: user.id };
    case PortalType.PROVIDER:
    case PortalType.FLOW:
    default:
      return { ...base, organisationId: orgId };
  }
}
