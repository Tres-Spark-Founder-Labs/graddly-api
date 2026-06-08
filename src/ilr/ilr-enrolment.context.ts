import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';

@Injectable()
export class IlrEnrolmentContext {
  constructor(
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(Organisation)
    private readonly organisationRepo: Repository<Organisation>,
  ) {}

  async requireEnrolmentGraph(
    organisationId: string,
    enrolmentId: string,
  ): Promise<{
    enrolment: Enrolment;
    apprentice: NonNullable<Enrolment['apprentice']>;
    standard: NonNullable<Enrolment['standard']>;
    organisation: Organisation;
  }> {
    const enrolment = await this.enrolmentRepo.findOne({
      where: { id: enrolmentId, organisationId, isDeleted: false },
      relations: ['apprentice', 'standard', 'organisation'],
    });
    if (!enrolment) {
      throw new NotFoundException('Enrolment not found');
    }
    if (!enrolment.apprentice || !enrolment.standard) {
      throw new NotFoundException('Enrolment relations missing');
    }
    const organisation =
      enrolment.organisation ??
      (await this.organisationRepo.findOne({
        where: { id: organisationId, isDeleted: false },
      }));
    if (!organisation) {
      throw new NotFoundException('Organisation not found');
    }
    return {
      enrolment,
      apprentice: enrolment.apprentice,
      standard: enrolment.standard,
      organisation,
    };
  }
}
