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
    const organisation = await this.organisationRepo.findOne({
      where: { id: organisationId, isDeleted: false },
    });
    if (!organisation) {
      throw new NotFoundException('Organisation not found');
    }
    if (organisation.portalType !== expected) {
      throw new ForbiddenException(
        `This endpoint requires an active ${expected} portal organisation`,
      );
    }
    return organisation;
  }
}
