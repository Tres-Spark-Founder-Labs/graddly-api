import { resolvePortalFrontendUrl } from '../../common/utils/resolve-portal-url.util.js';
import { EmailTemplate } from '../email-template.enum.js';
import { formatTokenTtlLabel } from '../format-token-ttl-label.js';

import { BaseEmailPayload } from './base-email.payload.js';

import type { PortalType } from '../../organisations/portal-type.enum.js';
import type { ConfigService } from '@nestjs/config';

export interface IInvitationAcceptEmailParams {
  to: string;
  firstName: string;
  token: string;
  organisationName: string;
  portalType?: PortalType;
  /** Actual Redis TTL (seconds) for accurate copy in the email. */
  tokenTtlSeconds?: number;
}

interface IInvitationAcceptTemplateContext {
  firstName: string;
  acceptUrl: string;
  organisationName: string;
  expiresInLabel: string;
}

export class InvitationAcceptEmail extends BaseEmailPayload {
  readonly template = EmailTemplate.INVITATION_ACCEPT;

  private constructor(
    readonly to: string,
    private readonly templateContext: IInvitationAcceptTemplateContext,
  ) {
    super();
  }

  static create(
    config: ConfigService,
    params: IInvitationAcceptEmailParams,
  ): InvitationAcceptEmail {
    const frontendBase = resolvePortalFrontendUrl(config, params.portalType);
    const ttlSeconds =
      params.tokenTtlSeconds ??
      config.get<number>('app.invitationAccept.tokenTtlSeconds', 604_800);
    const acceptUrl = `${frontendBase.replace(/\/$/, '')}/accept-invitation?token=${encodeURIComponent(params.token)}`;

    return new InvitationAcceptEmail(params.to, {
      firstName: params.firstName,
      organisationName: params.organisationName,
      acceptUrl,
      expiresInLabel: formatTokenTtlLabel(ttlSeconds),
    });
  }

  getTemplateContext(): Record<string, unknown> {
    return { ...this.templateContext };
  }
}
