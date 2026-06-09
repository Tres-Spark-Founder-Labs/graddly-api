import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { OtjLogStatus } from '../otj/enums/otj-log-status.enum.js';

/** Expected OTJ hours per month of programme duration (20% rule baseline). */
export const OTJ_HOURS_PER_PLANNED_MONTH = 20;

@Injectable()
export class OtjProgressMetricsService {
  constructor(
    @InjectRepository(OtjLogEntry)
    private readonly otjLogRepo: Repository<OtjLogEntry>,
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
  ) {}

  async averageOtjPercentForEnrolments(
    organisationId: string,
    enrolmentIds: string[],
  ): Promise<number | null> {
    if (enrolmentIds.length === 0) {
      return null;
    }

    const enrolments = await this.enrolmentRepo.findBy({
      id: In(enrolmentIds),
      organisationId,
      isDeleted: false,
    });
    if (enrolments.length === 0) {
      return null;
    }

    const approvedByEnrolment = await this.otjLogRepo
      .createQueryBuilder('entry')
      .select('entry.enrolmentId', 'enrolmentId')
      .addSelect('COALESCE(SUM(entry.minutes), 0)', 'approvedMinutes')
      .where('entry.organisationId = :organisationId', { organisationId })
      .andWhere('entry.enrolmentId IN (:...enrolmentIds)', { enrolmentIds })
      .andWhere('entry.status = :status', { status: OtjLogStatus.APPROVED })
      .andWhere('entry.isDeleted = false')
      .groupBy('entry.enrolmentId')
      .getRawMany<{ enrolmentId: string; approvedMinutes: string }>();

    const approvedMap = new Map(
      approvedByEnrolment.map((row) => [
        row.enrolmentId,
        Number(row.approvedMinutes),
      ]),
    );

    const percents: number[] = [];
    for (const enrolment of enrolments) {
      const percent = this.computePercentForEnrolment(
        enrolment,
        approvedMap.get(enrolment.id) ?? 0,
      );
      if (percent !== null) {
        percents.push(percent);
      }
    }

    if (percents.length === 0) {
      return null;
    }

    const average =
      percents.reduce((sum, value) => sum + value, 0) / percents.length;
    return Number(average.toFixed(2));
  }

  computePercentForEnrolment(
    enrolment: Pick<Enrolment, 'plannedDurationMonths'>,
    approvedMinutes: number,
  ): number | null {
    const months = enrolment.plannedDurationMonths;
    if (!months || months <= 0) {
      return null;
    }

    const expectedMinutes = months * OTJ_HOURS_PER_PLANNED_MONTH * 60;
    if (expectedMinutes <= 0) {
      return null;
    }

    const percent = (approvedMinutes / expectedMinutes) * 100;
    return Number(Math.min(percent, 100).toFixed(2));
  }
}
