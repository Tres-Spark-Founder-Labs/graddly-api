import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { ActiveOrganisationGuard } from '../auth/guards/active-organisation.guard.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { setCurrentUserId } from '../common/context/correlation-id-context.js';
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';
import { OrganisationRole } from '../organisations/organisation-role.enum.js';

import { DasManualService } from './das-manual.service.js';
import {
  ManualDonorLinkDto,
  ManualFundingPaymentDto,
  ManualIlrReceiptDto,
  ManualLevyBalanceDto,
  ManualLevyMonthlyDto,
  ManualLevyTranchesDto,
} from './dto/manual-das.dto.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

/**
 * Manual entry of the figures DAS would otherwise supply.
 *
 * For deployments with no ESFA credentials. Access to the DAS API takes weeks
 * to arrange, and without these routes the levy dashboard, the expiry banners
 * and the funding reports have nothing to show.
 *
 * ── OWNER AND ADMIN ONLY ────────────────────────────────────────────────────
 *
 * These figures drive what an employer believes about their own money. A member
 * can read the dashboard; only an owner or admin decides what it says.
 *
 * ── EVERY WRITE NAMES WHO MADE IT ───────────────────────────────────────────
 *
 * Each handler sets both tenant-context values before calling the service:
 *
 *   setCurrentUserId          the AsyncLocalStorage value the audit subscriber
 *                             reads for `actorUserId`
 *   setLastKnownUserIdForGuc  the fallback used when ALS is lost in a pool
 *                             callback — without it the RLS GUC resolves to an
 *                             empty string, and the write either fails the
 *                             policy or lands attributed to nobody
 *
 * Both, matching `das.controller.ts`. Setting only the first is the failure
 * that looks fine until a write happens on a pooled connection.
 */
@ApiTags('DAS manual entry')
@ApiBearerAuth()
@Controller({ path: 'das/manual', version: '1' })
@UseGuards(JwtAuthGuard, ActiveOrganisationGuard, RolesGuard)
@Roles(OrganisationRole.OWNER, OrganisationRole.ADMIN)
export class DasManualController {
  constructor(private readonly service: DasManualService) {}

  /** Sets both context values. Called at the top of every write handler. */
  private attribute(user: AuthenticatedUser): void {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
  }

  @Post('levy-balance')
  @ResponseMessage('Levy balance recorded successfully')
  @ApiOperation({
    summary: 'Record the levy balance by hand',
    description:
      'One row per organisation: submitting again corrects the figure rather ' +
      'than adding a second. Stored with lastSyncStatus = manual, so the sync ' +
      'card reports "Manually entered" rather than claiming a sync happened.',
  })
  @ApiCreatedResponse({ description: 'Balance recorded' })
  async setLevyBalance(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ManualLevyBalanceDto,
  ): Promise<{ balance: string | null; lastSyncedAt: string | null }> {
    this.attribute(user);
    const record = await this.service.setLevyBalance(user.organisationId!, dto);
    return {
      balance: record.balance,
      lastSyncedAt: record.lastSyncedAt?.toISOString() ?? null,
    };
  }

  @Put('levy-monthly')
  @ResponseMessage('Monthly levy entries replaced successfully')
  @ApiOperation({
    summary: 'Replace the monthly levy series',
    description:
      'REPLACES every monthly entry for the active organisation — this is not ' +
      'an upsert. The whole set is written in one transaction, so a failure ' +
      'part-way leaves the previous series intact rather than half a year. ' +
      'Months must be contiguous: gaps are allowed at either end (a levy year ' +
      'in progress) but not in the middle, where a missing month is a dropped ' +
      'row rather than a zero.',
  })
  @ApiOkResponse({ description: 'Series replaced' })
  async replaceMonthly(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ManualLevyMonthlyDto,
  ): Promise<{ replaced: number }> {
    this.attribute(user);
    const replaced = await this.service.replaceMonthlyEntries(
      user.organisationId!,
      dto,
    );
    return { replaced };
  }

  @Put('levy-tranches')
  @ResponseMessage('Levy tranches replaced successfully')
  @ApiOperation({
    summary: 'Replace the tranches on one DAS account',
    description:
      'REPLACES every tranche on the given donor link — not an upsert, and ' +
      'scoped to the link rather than the organisation. An organisation may ' +
      'hold several linked DAS accounts (F4.1.1 AC4), so tranches on its other ' +
      'links are untouched. Written in one transaction. The donor link must ' +
      'already exist: create it at POST /das/manual/donor-link.',
  })
  @ApiOkResponse({ description: 'Tranches replaced' })
  async replaceTranches(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ManualLevyTranchesDto,
  ): Promise<{ replaced: number }> {
    this.attribute(user);
    const replaced = await this.service.replaceTranches(
      user.organisationId!,
      dto,
    );
    return { replaced };
  }

  @Post('funding-payments')
  @ResponseMessage('Funding payment recorded successfully')
  @ApiOperation({
    summary: 'Record a funding payment by hand',
    description:
      'Keyed on externalReference per organisation, so re-entering a reference ' +
      'corrects that payment rather than double-counting it. A negative amount ' +
      'is a clawback and requires a clawbackNotice; payments synced from the ' +
      'ESFA are recorded as sent and carry no such requirement.',
  })
  @ApiCreatedResponse({ description: 'Payment recorded' })
  async recordFundingPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ManualFundingPaymentDto,
  ): Promise<{ externalReference: string; amount: string }> {
    this.attribute(user);
    const record = await this.service.recordFundingPayment(
      user.organisationId!,
      dto,
    );
    return {
      externalReference: record.externalReference,
      amount: record.amount,
    };
  }

  @Post('ilr-receipt')
  @ResponseMessage('ILR receipt recorded successfully')
  @ApiOperation({
    summary: 'Record the ESFA receipt for an ILR submission',
    description:
      'For an ILR built here and filed through the ESFA portal by hand. ' +
      'Writes the returned reference and the time the ESFA accepted it — not ' +
      'the time this was typed in — onto an existing submission.',
  })
  @ApiCreatedResponse({ description: 'Receipt recorded' })
  async recordIlrReceipt(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ManualIlrReceiptDto,
  ): Promise<{ submissionId: string; esfaReference: string | null }> {
    this.attribute(user);
    const record = await this.service.recordIlrReceipt(
      user.organisationId!,
      dto,
    );
    return { submissionId: record.id, esfaReference: record.esfaReference };
  }

  @Post('donor-link')
  @ResponseMessage('DAS account recorded successfully')
  @ApiOperation({
    summary: 'Record a DAS account by hand',
    description:
      'Created with status = manual rather than linked: no OAuth consent took ' +
      'place, and nothing should treat it as a live connection to sync ' +
      'against. Several per organisation is normal (F4.1.1 AC4). This is step ' +
      'one — tranches attach to a link and cannot be entered without one.',
  })
  @ApiCreatedResponse({ description: 'DAS account recorded' })
  async createDonorLink(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ManualDonorLinkDto,
  ): Promise<{ id: string; label: string | null; status: string }> {
    this.attribute(user);
    const link = await this.service.createDonorLink(user.organisationId!, dto);
    return { id: link.id, label: link.label, status: link.status };
  }

  @Get('donor-links')
  @ResponseMessage('DAS accounts retrieved successfully')
  @ApiOperation({
    summary: 'List the DAS accounts tranches can be attached to',
    description:
      'Read by the Levy data screen so the operator can choose which account ' +
      'a set of tranches belongs to, and so the tranche form can say plainly ' +
      'when none exists yet.',
  })
  @ApiOkResponse({ description: 'DAS accounts' })
  async listDonorLinks(@CurrentUser() user: AuthenticatedUser): Promise<
    {
      id: string;
      label: string | null;
      dasAccountId: string | null;
      status: string;
      lastBalance: string | null;
    }[]
  > {
    const links = await this.service.listDonorLinks(user.organisationId!);
    return links.map((l) => ({
      id: l.id,
      label: l.label,
      dasAccountId: l.dasAccountId,
      status: l.status,
      lastBalance: l.lastBalance,
    }));
  }
}
