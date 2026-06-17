import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { OrganisationRole } from '../organisations/organisation-role.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class PortfolioEnrolmentContext {
  constructor(
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
  ) {}

  async requireEnrolment(
    organisationId: string,
    enrolmentId: string,
    apprenticeId?: string,
  ): Promise<Enrolment> {
    const enrolment = await this.enrolmentRepo.findOne({
      where: { id: enrolmentId, organisationId, isDeleted: false },
    });
    if (!enrolment) {
      throw new NotFoundException('Enrolment not found');
    }
    if (apprenticeId !== undefined && enrolment.apprenticeId !== apprenticeId) {
      throw new BadRequestException(
        'Apprentice does not match the specified enrolment',
      );
    }
    return enrolment;
  }

  async requireEnrolmentForUser(
    user: AuthenticatedUser,
    enrolmentId: string,
  ): Promise<Enrolment> {
    const organisationId = user.organisationId!;
    const enrolment = await this.requireEnrolment(organisationId, enrolmentId);
    if (this.canAccessEnrolment(user, enrolment)) {
      return enrolment;
    }
    throw new ForbiddenException('Insufficient permissions for this enrolment');
  }

  canAccessEnrolment(user: AuthenticatedUser, enrolment: Enrolment): boolean {
    if (enrolment.apprenticeUserId === user.id) {
      return true;
    }
    if (enrolment.tutorUserId === user.id) {
      return true;
    }
    if (enrolment.employerManagerUserId === user.id) {
      return true;
    }
    const roles = user.roles ?? [];
    return (
      roles.includes(OrganisationRole.OWNER) ||
      roles.includes(OrganisationRole.ADMIN)
    );
  }
}
