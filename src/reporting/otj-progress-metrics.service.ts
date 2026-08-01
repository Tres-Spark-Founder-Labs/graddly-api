import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { OtjLogStatus } from '../otj/enums/otj-log-status.enum.js';

/** Expected OTJ hours per month of programme duration (20% rule baseline). */
export const OTJ_HOURS_PER_PLANNED_MONTH = 20;

/**
 * F1.4.2 — why the OTJ queries below scope by enrolment and not organisation.
 *
 * `otj_log_entries.organisationId` is stamped with whoever logged the hours,
 * which is the apprentice. It is *not* the employer, and
 * `OtjLogEntriesService.loadEmployerEnrolmentIds` already exists precisely
 * because of that: the employer approval queue has to scope by enrolment id
 * or it returns nothing.
 *
 * These metrics did not. They filtered `entry."organisationId" = <employer>`,
 * matched no rows, and computed every enrolment's progress from zero approved
 * minutes — which `computePercentForEnrolment` turns into **0%**, not null.
 * So the F1.4.2 provider comparison showed every provider at 0% average OTJ,
 * in red, including providers whose apprentices were fully on track. A
 * confident wrong number on the table an employer uses to judge providers.
 *
 * The enrolment id is the real scope key: an OTJ entry belongs to exactly one
 * enrolment, the caller has already resolved which enrolments it may see, and
 * row-level security remains the backstop underneath — `otj_log_entries`
 * gained a linked-org SELECT policy in 1781100000018, so the database was
 * already willing to return these rows. Only the WHERE clause was not.
 */

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
      .where('entry.enrolmentId IN (:...enrolmentIds)', { enrolmentIds })
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

  /**
   * The organisation is no longer a parameter. It was only ever used to filter
   * the OTJ rows, which is the bug described above — and a parameter named
   * `organisationId` that no longer scopes anything is worse than none at all,
   * because the next reader assumes it does.
   */
  async percentForEnrolment(
    enrolment: Pick<Enrolment, 'id' | 'plannedDurationMonths'>,
  ): Promise<number | null> {
    const approvedMinutes = await this.approvedMinutesForEnrolment(
      enrolment.id,
    );
    return this.computePercentForEnrolment(enrolment, approvedMinutes);
  }

  async approvedMinutesForEnrolment(enrolmentId: string): Promise<number> {
    const result = await this.otjLogRepo
      .createQueryBuilder('entry')
      .select('COALESCE(SUM(entry.minutes), 0)', 'total')
      .where('entry.enrolmentId = :enrolmentId', { enrolmentId })
      .andWhere('entry.status = :status', { status: OtjLogStatus.APPROVED })
      .andWhere('entry.isDeleted = false')
      .getRawOne<{ total: string }>();
    return Number(result?.total ?? 0);
  }
}
