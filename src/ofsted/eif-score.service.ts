import { Injectable } from '@nestjs/common';

import { percentToEifRag } from './eif-rag.util.js';
import { EifScoreCacheService } from './eif-score-cache.service.js';
import { EifScoreCalculatorService } from './eif-score-calculator.service.js';

import type { EifScoresPayloadDto } from './dto/eif-scores-response.dto.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class EifScoreService {
  constructor(
    private readonly cache: EifScoreCacheService,
    private readonly calculator: EifScoreCalculatorService,
  ) {}

  async getScores(user: AuthenticatedUser): Promise<EifScoresPayloadDto> {
    const organisationId = user.organisationId!;

    const cached = await this.cache.get(organisationId);
    if (cached) {
      return { ...cached, cached: true };
    }

    const computed = await this.calculator.calculate(organisationId);
    const payload: EifScoresPayloadDto = {
      ...computed,
      overallRag: percentToEifRag(computed.overallPercent),
      cached: false,
    };
    await this.cache.set(organisationId, payload);
    return payload;
  }
}
