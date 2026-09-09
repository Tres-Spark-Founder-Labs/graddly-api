import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Organisation } from '../organisations/entities/organisation.entity.js';
import { PortalType } from '../organisations/portal-type.enum.js';

@Injectable()
export class ReportingPortalService {
  constructor(
    @InjectRepository(Organisation)
    private readonly organisationRepo: Repository<Organisation>,
  ) {}

  async assertPortalType(
    organisationId: string,
    expected: PortalType,
  ): Promise<Organisation> {
    return this.assertPortalTypeIn(organisationId, [expected]);
  }

  /**
   * Admit any one of several portal types, and say which the caller is.
   *
   * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
   *
   * Some endpoints serve both parties to an enrolment from one route, deriving
   * a different view for each: the learner profile is the employer's own
   * apprentice and the provider's own learner, and it is the same record.
   * Expressing that as a single `assertPortalType(PROVIDER)` locked the
   * employer out of a Phase 1 Must Have (F1.2.2).
   *
   * It returns the organisation rather than a boolean because the caller
   * almost always needs to know *which* type it got — the authorisation
   * decision and the query predicate are the same decision, and splitting them
   * across two lookups is how they drift apart.
   */
  async assertPortalTypeIn(
    organisationId: string,
    expected: PortalType[],
  ): Promise<Organisation> {
    const organisation = await this.organisationRepo.findOne({
      where: { id: organisationId, isDeleted: false },
    });
    if (!organisation) {
      throw new NotFoundException('Organisation not found');
    }
    // `portalType` is nullable on the entity, and a null is not one of the
    // expected types — an organisation with no portal is refused rather than
    // matched, which is what the non-null assertion here would have hidden.
    const actual = organisation.portalType;
    if (actual === null || actual === undefined || !expected.includes(actual)) {
      // Wording preserved for the single-type case: existing tests and clients
      // match on it, and a broadened message would be a silent contract change.
      const description =
        expected.length === 1
          ? `an active ${expected[0]} portal organisation`
          : `an active ${expected.slice(0, -1).join(', ')} or ${
              expected[expected.length - 1]
            } portal organisation`;
      throw new ForbiddenException(`This endpoint requires ${description}`);
    }
    return organisation;
  }
}
