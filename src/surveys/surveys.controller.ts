import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { Capability } from '../auth/capabilities/capability.enum.js';
import { RequiresCapability } from '../auth/capabilities/requires-capability.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ActiveOrganisationGuard } from '../auth/guards/active-organisation.guard.js';
import { CapabilityGuard } from '../auth/guards/capability.guard.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ORGANISATION_ID_HEADER } from '../common/constants/organisation-headers.js';
import { setCurrentUserId } from '../common/context/correlation-id-context.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import { CreateSurveyCampaignDto } from './dto/create-survey-campaign.dto.js';
import { CreateSurveyTemplateDto } from './dto/create-survey-template.dto.js';
import { SurveysService } from './surveys.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

/** F2.4.3 — provider-side survey management. */
@ApiTags('Employer Surveys')
@Controller({ path: 'surveys', version: '1' })
@UseGuards(JwtAuthGuard, ActiveOrganisationGuard)
@ApiBearerAuth()
@ApiHeader({
  name: ORGANISATION_ID_HEADER,
  description: 'Active organisation UUID (optional override)',
  required: false,
})
@ApiUnauthorizedResponse({
  description: 'Missing or invalid bearer token',
  type: ErrorResponseDto,
})
@ApiForbiddenResponse({
  description: 'No active organisation context, or not a provider portal',
  type: ErrorResponseDto,
})
export class SurveysController {
  constructor(private readonly service: SurveysService) {}

  @Post('templates')
  @UseGuards(CapabilityGuard)
  @RequiresCapability(Capability.MANAGE_SURVEYS)
  @ResponseMessage('Survey template created successfully')
  @ApiOperation({ summary: 'Create a survey template (up to 10 questions)' })
  @ApiCreatedResponse({ description: 'The created template' })
  @ApiBadRequestResponse({
    description: 'More than 10 questions, or an invalid question type',
    type: ErrorResponseDto,
  })
  async createTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSurveyTemplateDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.service.createTemplate(user, dto);
  }

  @Get('templates')
  @ResponseMessage('Survey templates retrieved successfully')
  @ApiOperation({ summary: 'List survey templates' })
  @ApiOkResponse({ description: 'Templates, newest first' })
  async listTemplates(@CurrentUser() user: AuthenticatedUser) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    await this.service.assertProvider(user);
    return this.service.listTemplates(user);
  }

  /**
   * F2.4.3 AC2 — send a survey.
   *
   * The response carries the plaintext survey links **once**. Tokens are
   * hashed at rest, so this is the only opportunity to build the emails; a
   * caller that discards them must create a new campaign.
   */
  @Post('campaigns')
  @UseGuards(CapabilityGuard)
  @RequiresCapability(Capability.MANAGE_SURVEYS)
  @ResponseMessage('Survey campaign created successfully')
  @ApiOperation({
    summary: 'Create a campaign and mint one survey link per recipient',
    description:
      'Returns plaintext survey links once — tokens are stored hashed and ' +
      'cannot be recovered afterwards.',
  })
  @ApiCreatedResponse({ description: 'The campaign and its survey links' })
  @ApiNotFoundResponse({
    description: 'Template not found in this organisation',
    type: ErrorResponseDto,
  })
  async createCampaign(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSurveyCampaignDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.service.createCampaign(user, dto);
  }

  @Get('campaigns')
  @ResponseMessage('Survey campaigns retrieved successfully')
  @ApiOperation({ summary: 'List survey campaigns with response progress' })
  @ApiOkResponse({ description: 'Campaigns, newest first' })
  async listCampaigns(@CurrentUser() user: AuthenticatedUser) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    await this.service.assertProvider(user);

    const campaigns = await this.service.listCampaigns(user);
    const counts = await this.service.countsByCampaign(
      user.organisationId!,
      campaigns.map((c) => c.id),
    );

    return campaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      closesAt: campaign.closesAt.toISOString(),
      resultsAvailableAt: campaign.resultsAvailableAt.toISOString(),
      resultsAvailable: Date.now() >= campaign.resultsAvailableAt.getTime(),
      invitedCount: counts.get(campaign.id)?.invited ?? 0,
      responseCount: counts.get(campaign.id)?.responded ?? 0,
    }));
  }

  /**
   * F2.4.3 AC3 and AC4 — the results dashboard, embargoed until 24 hours
   * after close.
   */
  @Get('campaigns/:id/results')
  @ResponseMessage('Survey results retrieved successfully')
  @ApiOperation({
    summary: 'Response rate, per-question averages, NPS and free-text terms',
    description:
      'Scores are withheld until 24 hours after the survey closes (AC4). ' +
      'Response counts are always returned, so a provider can tell whether ' +
      'to chase, without seeing how anyone scored them.',
  })
  @ApiOkResponse({ description: 'Results, or counts only while embargoed' })
  @ApiNotFoundResponse({
    description: 'Campaign not found in this organisation',
    type: ErrorResponseDto,
  })
  async getResults(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    await this.service.assertProvider(user);
    return this.service.getResults(user, id);
  }
}
