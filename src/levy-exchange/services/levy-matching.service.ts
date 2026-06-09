import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Organisation } from '../../organisations/entities/organisation.entity.js';
import { loadMatchingRulesConfig } from '../config/matching-rules.config.js';
import { MatchResultDto } from '../dto/match-result.dto.js';
import { SearchMatchesResponseDto } from '../dto/search-matches-response.dto.js';
import { SearchMatchesDto } from '../dto/search-matches.dto.js';
import { LevyRecipientProfile } from '../entities/levy-recipient-profile.entity.js';
import { LevyTransferPreference } from '../entities/levy-transfer-preference.entity.js';
import { LevyWaitingPoolEntry } from '../entities/levy-waiting-pool-entry.entity.js';

import { LevyRecipientProfileService } from './levy-recipient-profile.service.js';
import { LevySurplusService } from './levy-surplus.service.js';
import { LevyTransferPreferenceService } from './levy-transfer-preference.service.js';

type ScoredCandidate = MatchResultDto & { numericScore: number };

@Injectable()
export class LevyMatchingService {
  constructor(
    private readonly recipientProfileService: LevyRecipientProfileService,
    private readonly transferPreferenceService: LevyTransferPreferenceService,
    private readonly surplusService: LevySurplusService,
    @InjectRepository(Organisation)
    private readonly organisationRepo: Repository<Organisation>,
    @InjectRepository(LevyWaitingPoolEntry)
    private readonly waitingPoolRepo: Repository<LevyWaitingPoolEntry>,
  ) {}

  async searchMatches(
    organisationId: string,
    dto: SearchMatchesDto = {},
  ): Promise<SearchMatchesResponseDto> {
    const rules = loadMatchingRulesConfig();
    const profile =
      await this.recipientProfileService.getEntityOrThrow(organisationId);
    const donorPreferences =
      await this.transferPreferenceService.findAllActive();
    const eligibleDonors = donorPreferences.filter(
      (preference) =>
        preference.organisationId !== organisationId &&
        this.passesPreferenceFilters(preference, profile),
    );

    const donorOrgIds = eligibleDonors.map(
      (preference) => preference.organisationId,
    );
    const surplusByOrg =
      await this.surplusService.getLatestForOrganisations(donorOrgIds);
    const organisations = donorOrgIds.length
      ? await this.organisationRepo.find({
          where: donorOrgIds.map((id) => ({ id, isDeleted: false })),
        })
      : [];
    const orgNameById = new Map(
      organisations.map((organisation) => [organisation.id, organisation.name]),
    );

    const candidates: ScoredCandidate[] = [];
    for (const preference of eligibleDonors) {
      const surplus = surplusByOrg.get(preference.organisationId);
      if (!surplus) {
        continue;
      }

      const transferableAmount = this.resolveTransferableAmount(
        profile.transferAmountRequired,
        surplus.availableSurplus,
        preference.maxPerRecipient,
      );
      if (this.surplusService.compareAmounts(transferableAmount, '0') <= 0) {
        continue;
      }

      const scoreBreakdown = this.buildScoreBreakdown(
        preference,
        profile,
        transferableAmount,
        rules.wildcardScore,
        rules.amountBands,
      );
      const numericScore = this.weightedScore(scoreBreakdown, rules.weights);
      if (numericScore < rules.minimumScore) {
        continue;
      }

      candidates.push({
        donorOrganisationId: preference.organisationId,
        donorDisplayName: preference.anonymousMatching
          ? 'Matched donor'
          : (orgNameById.get(preference.organisationId) ?? 'Matched donor'),
        matchScore: numericScore.toFixed(2),
        scoreBreakdown,
        availableSurplus: surplus.availableSurplus,
        transferableAmount,
        programmeEligible: scoreBreakdown.programmeType > 0,
        numericScore,
      });
    }

    candidates.sort((left, right) => right.numericScore - left.numericScore);
    const limit = Math.min(dto.limit ?? rules.maxResults, rules.maxResults);
    const matches = candidates.slice(0, limit).map((candidate) => ({
      donorOrganisationId: candidate.donorOrganisationId,
      donorDisplayName: candidate.donorDisplayName,
      matchScore: candidate.matchScore,
      scoreBreakdown: candidate.scoreBreakdown,
      availableSurplus: candidate.availableSurplus,
      transferableAmount: candidate.transferableAmount,
      programmeEligible: candidate.programmeEligible,
    }));

    let addedToWaitingPool = false;
    if (matches.length === 0) {
      addedToWaitingPool = await this.upsertWaitingPoolEntry(organisationId);
    }

    return { matches, addedToWaitingPool };
  }

  private passesPreferenceFilters(
    preference: LevyTransferPreference,
    profile: LevyRecipientProfile,
  ): boolean {
    if (preference.openMatching) {
      return true;
    }

    if (
      preference.sectors.length > 0 &&
      !preference.sectors.includes(profile.sector)
    ) {
      return false;
    }
    if (
      preference.regions.length > 0 &&
      !preference.regions.includes(profile.region)
    ) {
      return false;
    }
    if (
      preference.sizeBands.length > 0 &&
      !preference.sizeBands.includes(profile.employeeCountBand)
    ) {
      return false;
    }
    if (
      preference.programmeTypes.length > 0 &&
      !preference.programmeTypes.includes(profile.programmeType)
    ) {
      return false;
    }
    return true;
  }

  private resolveTransferableAmount(
    requiredAmount: string,
    availableSurplus: string,
    maxPerRecipient: string | null,
  ): string {
    let amount = this.surplusService.minAmount(
      requiredAmount,
      availableSurplus,
    );
    if (maxPerRecipient) {
      amount = this.surplusService.minAmount(amount, maxPerRecipient);
    }
    return amount;
  }

  private buildScoreBreakdown(
    preference: LevyTransferPreference,
    profile: LevyRecipientProfile,
    transferableAmount: string,
    wildcardScore: number,
    amountBands: { minRatio: number; score: number }[],
  ) {
    return {
      sector: this.dimensionScore(
        preference.openMatching,
        preference.sectors,
        profile.sector,
        wildcardScore,
      ),
      region: this.dimensionScore(
        preference.openMatching,
        preference.regions,
        profile.region,
        wildcardScore,
      ),
      programmeType: this.dimensionScore(
        preference.openMatching,
        preference.programmeTypes,
        profile.programmeType,
        wildcardScore,
      ),
      amount: this.amountScore(
        transferableAmount,
        profile.transferAmountRequired,
        amountBands,
      ),
    };
  }

  private dimensionScore(
    openMatching: boolean,
    preferredValues: string[],
    actualValue: string,
    wildcardScore: number,
  ): number {
    if (openMatching || preferredValues.length === 0) {
      return wildcardScore;
    }
    return preferredValues.includes(actualValue) ? 100 : 0;
  }

  private amountScore(
    transferableAmount: string,
    requiredAmount: string,
    amountBands: { minRatio: number; score: number }[],
  ): number {
    const required = Number.parseFloat(requiredAmount);
    if (required <= 0) {
      return 0;
    }
    const ratio = Number.parseFloat(transferableAmount) / required;
    for (const band of amountBands) {
      if (ratio >= band.minRatio) {
        return band.score;
      }
    }
    return 0;
  }

  private weightedScore(
    breakdown: {
      sector: number;
      region: number;
      programmeType: number;
      amount: number;
    },
    weights: {
      sector: number;
      region: number;
      programmeType: number;
      amount: number;
    },
  ): number {
    const totalWeight =
      weights.sector + weights.region + weights.programmeType + weights.amount;
    if (totalWeight <= 0) {
      return 0;
    }

    const weighted =
      breakdown.sector * weights.sector +
      breakdown.region * weights.region +
      breakdown.programmeType * weights.programmeType +
      breakdown.amount * weights.amount;
    return weighted / totalWeight;
  }

  private async upsertWaitingPoolEntry(
    organisationId: string,
  ): Promise<boolean> {
    const existing = await this.waitingPoolRepo.findOne({
      where: { organisationId, active: true, isDeleted: false },
    });
    if (existing) {
      return false;
    }

    await this.waitingPoolRepo.save(
      this.waitingPoolRepo.create({
        organisationId,
        enteredAt: new Date(),
        active: true,
      }),
    );
    return true;
  }
}
