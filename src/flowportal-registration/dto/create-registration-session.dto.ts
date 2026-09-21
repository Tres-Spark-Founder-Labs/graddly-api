import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import {
  closedVocabularyMessage,
  LEVY_REGIONS,
} from '../../levy-exchange/levy-vocabulary.js';

/**
 * ── SECTOR AND REGION ARE THE LEVY EXCHANGE VOCABULARY ──────────────────────
 *
 * Both are seeded from the eligibility checker's answers, carried on the
 * registration link, and they end up describing the SME whose recipient
 * profile matching compares against a donor's preferences. They were
 * unvalidated passthrough with slug examples (`construction`, `north_west`),
 * so a session could be created with a value no profile can hold and no donor
 * can match — the checker's old vocabulary surviving one hop further along.
 *
 * Held to the same rule as the profile PUT, for the same reason: `region` is
 * closed and rejected by name when it is not one of the twelve; `sector` is
 * open, because no list of UK SME sectors is complete, and is normalised on
 * write instead (see `RegistrationSessionService.create`).
 *
 * ── THIS IS THE STRICT SIDE ─────────────────────────────────────────────────
 *
 * A value in this body is data on the write, and is validated strictly: a
 * region outside the vocabulary is a 422. That is deliberate and stays.
 *
 * The lenient side is the prefill, and it is not here. The flow app reads
 * sector and region from the /register link as hints and drops a region the
 * vocabulary no longer permits before calling this endpoint
 * (`registrationPrefill`, apps/flow/features/flowportal-registration/
 * schemas), so an old bookmarked link — `region=north_west` — starts a
 * session without the hint instead of failing. Old slugs are not translated
 * anywhere: a slug-to-value map would be a second vocabulary.
 */
export class CreateRegistrationSessionDto {
  @ApiPropertyOptional({
    example: 'employer@example.com',
    description: 'Contact email for confirmation (optional at start)',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  contactEmail?: string;

  @ApiPropertyOptional({
    example: 'Construction',
    description:
      'Sector pre-seeded from the eligibility checker. Open vocabulary ' +
      'field: any value, normalised on write. Suggestions from GET ' +
      '/levy-exchange/vocabulary (open.sector).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sector?: string;

  @ApiPropertyOptional({
    enum: LEVY_REGIONS,
    example: 'North West',
    description:
      'Region pre-seeded from the eligibility checker. Closed vocabulary ' +
      'field: one of GET /levy-exchange/vocabulary closed.region.',
  })
  @IsOptional()
  @IsIn(LEVY_REGIONS, {
    message: closedVocabularyMessage('region', LEVY_REGIONS),
  })
  region?: string;
}
