import { randomBytes, createHash } from 'node:crypto';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import {
  getRlsBootstrap,
  setRlsBootstrap,
} from '../common/context/correlation-id-context.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { ReportingPortalService } from '../reporting/reporting-portal.service.js';

import { SurveyCampaign } from './entities/survey-campaign.entity.js';
import {
  SurveyInvitation,
  type SurveyAnswers,
} from './entities/survey-invitation.entity.js';
import { SurveyTemplate } from './entities/survey-template.entity.js';
import {
  SURVEY_SCALE_BOUNDS,
  SurveyQuestionType,
  type ISurveyQuestion,
} from './enums/survey-question-type.enum.js';
import {
  buildQuestionResults,
  computeNps,
  computeTopTerms,
} from './survey-results.util.js';

import type { CreateSurveyCampaignDto } from './dto/create-survey-campaign.dto.js';
import type { CreateSurveyTemplateDto } from './dto/create-survey-template.dto.js';
import type { SubmitSurveyResponseDto } from './dto/submit-survey-response.dto.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

/**
 * F2.4.3 AC4 — "results are available 24 hours after survey closes".
 *
 * The embargo is the point of the criterion, not an implementation detail: it
 * stops a provider watching responses arrive in real time and chasing the
 * employers who scored them badly before the survey closes.
 */
export const SURVEY_RESULTS_EMBARGO_HOURS = 24;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class SurveysService {
  constructor(
    @InjectRepository(SurveyTemplate)
    private readonly templateRepo: Repository<SurveyTemplate>,
    @InjectRepository(SurveyCampaign)
    private readonly campaignRepo: Repository<SurveyCampaign>,
    @InjectRepository(SurveyInvitation)
    private readonly invitationRepo: Repository<SurveyInvitation>,
    private readonly portalService: ReportingPortalService,
    private readonly config: ConfigService,
  ) {}

  // ─── Templates (AC1) ──────────────────────────────────────────────────────

  async createTemplate(
    user: AuthenticatedUser,
    dto: CreateSurveyTemplateDto,
  ): Promise<SurveyTemplate> {
    const organisationId = user.organisationId!;
    await this.portalService.assertPortalType(
      organisationId,
      PortalType.PROVIDER,
    );

    return this.templateRepo.save(
      this.templateRepo.create({
        organisationId,
        name: dto.name.trim(),
        questions: dto.questions.map((question, index) => ({
          // Stable ids assigned server-side. Answers are keyed by these, so a
          // client-chosen id that collided would silently merge two questions'
          // answers into one.
          id: `q${index + 1}`,
          type: question.type,
          prompt: question.prompt.trim(),
        })),
      }),
    );
  }

  async listTemplates(user: AuthenticatedUser): Promise<SurveyTemplate[]> {
    return this.templateRepo.find({
      where: { organisationId: user.organisationId!, isDeleted: false },
      order: { createdAt: 'DESC' },
    });
  }

  // ─── Campaigns and sending (AC2) ──────────────────────────────────────────

  /**
   * Create a campaign and mint one invitation per recipient.
   *
   * Returns the plaintext tokens **once**. They are hashed at rest, so this
   * response is the only chance to build the emails — a caller that discards
   * them cannot recover the links and must re-send the campaign.
   */
  async createCampaign(
    user: AuthenticatedUser,
    dto: CreateSurveyCampaignDto,
  ): Promise<{
    campaign: SurveyCampaign;
    invitations: { contactEmail: string; token: string; url: string }[];
  }> {
    const organisationId = user.organisationId!;
    await this.portalService.assertPortalType(
      organisationId,
      PortalType.PROVIDER,
    );

    const template = await this.templateRepo.findOne({
      where: { id: dto.templateId, organisationId, isDeleted: false },
    });
    if (!template) {
      throw new NotFoundException('Survey template not found');
    }

    const closesAt = new Date(dto.closesAt);
    if (closesAt.getTime() <= Date.now()) {
      throw new BadRequestException('Survey close date must be in the future');
    }

    const campaign = await this.campaignRepo.save(
      this.campaignRepo.create({
        organisationId,
        templateId: template.id,
        name: dto.name.trim(),
        // Frozen copy — see the entity comment.
        questions: template.questions,
        closesAt,
        resultsAvailableAt: new Date(
          closesAt.getTime() + SURVEY_RESULTS_EMBARGO_HOURS * 60 * 60 * 1000,
        ),
      }),
    );

    const baseUrl = this.config.get<string>('app.frontendBaseUrl', '');
    const minted = dto.recipients.map((recipient) => {
      // 32 bytes: this is an unauthenticated bearer credential for a survey
      // link that will sit in an inbox for weeks.
      const token = randomBytes(32).toString('base64url');
      return {
        token,
        contactEmail: recipient.contactEmail.trim().toLowerCase(),
        employerOrganisationId: recipient.employerOrganisationId ?? null,
      };
    });

    await this.invitationRepo.save(
      minted.map((item) =>
        this.invitationRepo.create({
          organisationId,
          campaignId: campaign.id,
          employerOrganisationId: item.employerOrganisationId,
          contactEmail: item.contactEmail,
          tokenHash: hashToken(item.token),
        }),
      ),
    );

    return {
      campaign,
      invitations: minted.map((item) => ({
        contactEmail: item.contactEmail,
        token: item.token,
        url: `${baseUrl}/surveys/${item.token}`,
      })),
    };
  }

  async listCampaigns(user: AuthenticatedUser): Promise<SurveyCampaign[]> {
    return this.campaignRepo.find({
      where: { organisationId: user.organisationId!, isDeleted: false },
      order: { createdAt: 'DESC' },
    });
  }

  // ─── Public response path (AC2 — no login) ────────────────────────────────

  /**
   * Resolve a survey link to the questions it is asking.
   *
   * Unauthenticated by design. Everything it returns is deliberately minimal:
   * the campaign name and its questions, and nothing about the provider, the
   * other recipients, or how anyone else answered.
   */
  async getPublicSurvey(token: string): Promise<{
    campaignName: string;
    questions: ISurveyQuestion[];
    alreadyResponded: boolean;
    closesAt: string;
  }> {
    const { invitation, campaign } = await this.resolveToken(token);

    return {
      campaignName: campaign.name,
      questions: campaign.questions,
      alreadyResponded: invitation.respondedAt !== null,
      closesAt: campaign.closesAt.toISOString(),
    };
  }

  async submitPublicResponse(
    token: string,
    dto: SubmitSurveyResponseDto,
  ): Promise<{ recorded: true }> {
    const { invitation, campaign } = await this.resolveToken(token);

    if (campaign.closesAt.getTime() <= Date.now()) {
      throw new BadRequestException('This survey has closed');
    }
    /**
     * One response per invitation.
     *
     * Not merely tidiness: the link is emailed and may be forwarded, and
     * allowing overwrites would let a second holder of the link silently
     * replace an employer's answers.
     */
    if (invitation.respondedAt) {
      throw new BadRequestException(
        'A response has already been recorded for this link',
      );
    }

    invitation.answers = this.validateAnswers(campaign.questions, dto.answers);
    invitation.respondedAt = new Date();

    // Same reason as the lookup: the respondent has no organisation context,
    // so the UPDATE policy would reject this write without the bootstrap.
    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    try {
      await this.invitationRepo.save(invitation);
    } finally {
      setRlsBootstrap(previousBootstrap);
    }

    return { recorded: true };
  }

  /**
   * Answers are validated against the campaign's own frozen questions.
   *
   * An answer to a question the campaign does not ask is dropped rather than
   * stored: unknown keys would sit in the jsonb forever and appear in no
   * report, which is worse than refusing them.
   */
  private validateAnswers(
    questions: ISurveyQuestion[],
    submitted: Record<string, number | string>,
  ): SurveyAnswers {
    const answers: SurveyAnswers = {};

    for (const question of questions) {
      const value = submitted[question.id];
      if (value === undefined || value === null || value === '') {
        continue;
      }

      if (question.type === SurveyQuestionType.TEXT) {
        answers[question.id] = String(value).slice(0, 2000);
        continue;
      }

      const numeric = Number(value);
      const bounds = SURVEY_SCALE_BOUNDS[question.type];
      if (
        !Number.isFinite(numeric) ||
        numeric < bounds.min ||
        numeric > bounds.max
      ) {
        throw new BadRequestException(
          `Answer to "${question.prompt}" must be between ${bounds.min} and ${bounds.max}`,
        );
      }
      answers[question.id] = numeric;
    }

    if (Object.keys(answers).length === 0) {
      throw new BadRequestException('Answer at least one question');
    }

    return answers;
  }

  /**
   * Resolve a survey token with row-level security bootstrapped.
   *
   * The respondent is not logged in and has no organisation context, so RLS
   * would find nothing — these tables are partitioned by `organisationId` and
   * `app_current_org()` is empty on an unauthenticated request. The token is
   * the authorisation: holding it proves the bearer was sent this survey.
   *
   * The bootstrap is deliberately confined to this lookup and restored in a
   * `finally`, so a request that raises mid-flight cannot leave the flag on
   * and turn a later query in the same context into a cross-tenant read.
   */
  private async resolveToken(token: string): Promise<{
    invitation: SurveyInvitation;
    campaign: SurveyCampaign;
  }> {
    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    try {
      const invitation = await this.invitationRepo.findOne({
        where: { tokenHash: hashToken(token), isDeleted: false },
      });
      /**
       * The same message for a token that does not exist and a campaign that
       * has vanished. Distinguishing them tells someone probing tokens which
       * guesses were closer.
       */
      if (!invitation) {
        throw new NotFoundException('Survey link not found');
      }

      const campaign = await this.campaignRepo.findOne({
        where: { id: invitation.campaignId, isDeleted: false },
      });
      if (!campaign) {
        throw new NotFoundException('Survey link not found');
      }

      return { invitation, campaign };
    } finally {
      setRlsBootstrap(previousBootstrap);
    }
  }

  // ─── Results (AC3, AC4) ───────────────────────────────────────────────────

  async getResults(user: AuthenticatedUser, campaignId: string) {
    const organisationId = user.organisationId!;
    const campaign = await this.campaignRepo.findOne({
      where: { id: campaignId, organisationId, isDeleted: false },
    });
    if (!campaign) {
      throw new NotFoundException('Survey campaign not found');
    }

    const invitations = await this.invitationRepo.find({
      where: { organisationId, campaignId, isDeleted: false },
    });
    const responded = invitations.filter((i) => i.respondedAt !== null);

    /**
     * F2.4.3 AC4 — the embargo, enforced rather than displayed.
     *
     * The response still reports the counts and the unlock time, because
     * "how many have replied" is not a result and a provider needs it to know
     * whether to chase. What it withholds is every score: no averages, no NPS,
     * no free text. Returning them with a flag saying "not yet available"
     * would be a lock with the key taped to it.
     */
    const unlocked = Date.now() >= campaign.resultsAvailableAt.getTime();

    const base = {
      campaignId: campaign.id,
      campaignName: campaign.name,
      closesAt: campaign.closesAt.toISOString(),
      resultsAvailableAt: campaign.resultsAvailableAt.toISOString(),
      resultsAvailable: unlocked,
      invitedCount: invitations.length,
      responseCount: responded.length,
      responseRatePercent:
        invitations.length === 0
          ? null
          : Math.round((responded.length / invitations.length) * 100),
    };

    if (!unlocked) {
      return { ...base, npsScore: null, questions: [], topTerms: [] };
    }

    const answerSets = responded.map((i) => i.answers ?? {});
    const questionResults = buildQuestionResults(
      campaign.questions,
      answerSets,
    );

    const npsQuestion = campaign.questions.find(
      (q) => q.type === SurveyQuestionType.NPS,
    );
    const npsScores = npsQuestion
      ? answerSets
          .map((answers) => Number(answers[npsQuestion.id]))
          .filter((value) => Number.isFinite(value))
      : [];

    return {
      ...base,
      // Null when the survey asked no NPS question at all — distinct from a
      // survey that asked and got no answers.
      npsScore: npsQuestion ? computeNps(npsScores) : null,
      questions: questionResults,
      topTerms: computeTopTerms(
        questionResults.flatMap((q) => q.textResponses),
      ),
    };
  }

  /** Guards the results route against non-provider organisations. */
  async assertProvider(user: AuthenticatedUser): Promise<void> {
    if (!user.organisationId) {
      throw new ForbiddenException('No active organisation');
    }
    await this.portalService.assertPortalType(
      user.organisationId,
      PortalType.PROVIDER,
    );
  }

  /** Used by the campaign list screen to show response progress. */
  async countsByCampaign(
    organisationId: string,
    campaignIds: string[],
  ): Promise<Map<string, { invited: number; responded: number }>> {
    if (campaignIds.length === 0) {
      return new Map();
    }
    const invitations = await this.invitationRepo.find({
      where: { organisationId, campaignId: In(campaignIds), isDeleted: false },
    });

    const map = new Map<string, { invited: number; responded: number }>();
    for (const invitation of invitations) {
      const entry = map.get(invitation.campaignId) ?? {
        invited: 0,
        responded: 0,
      };
      entry.invited += 1;
      if (invitation.respondedAt) {
        entry.responded += 1;
      }
      map.set(invitation.campaignId, entry);
    }
    return map;
  }
}
