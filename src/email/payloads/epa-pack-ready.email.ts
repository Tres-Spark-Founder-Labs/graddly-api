import { resolvePortalFrontendUrl } from '../../common/utils/resolve-portal-url.util.js';
import { PortalType } from '../../organisations/portal-type.enum.js';
import { EmailTemplate } from '../email-template.enum.js';
import { formatTokenTtlLabel } from '../format-token-ttl-label.js';

import { BaseEmailPayload } from './base-email.payload.js';

import type { ConfigService } from '@nestjs/config';

export interface IEpaPackReadyEmailParams {
  to: string;
  firstName: string;
  /** The presigned link, already created with the emailed-link TTL. */
  downloadUrl: string;
  /** When that link stops working. */
  expiresAt: Date;
}

interface IEpaPackReadyTemplateContext {
  firstName: string;
  downloadUrl: string;
  /** "24 hours" — the configured TTL, not the remaining time. */
  expiresInLabel: string;
  /** "22 Sept 2026, 10:15" in UK time, so the reader has an absolute time. */
  expiresAtLabel: string;
  /** Where to export again once the link has expired; '' when unconfigured. */
  packPageUrl: string;
}

/**
 * F3.3.4 AC5 — "Download link is also sent by email for convenience".
 *
 * Sent by EpaPackEmailService once per completed pack job, to whoever
 * requested the export. The link in it is a presigned URL: anyone holding it
 * can download the pack until it expires, which is why the body states the
 * expiry plainly and asks the reader to keep the email to themselves.
 */
export class EpaPackReadyEmail extends BaseEmailPayload {
  readonly template = EmailTemplate.EPA_PACK_READY;

  private constructor(
    readonly to: string,
    private readonly templateContext: IEpaPackReadyTemplateContext,
  ) {
    super();
  }

  static create(
    config: ConfigService,
    params: IEpaPackReadyEmailParams,
  ): EpaPackReadyEmail {
    const ttlSeconds = config.get<number>(
      'app.epaPack.emailLinkTtlSeconds',
      86400,
    );
    const frontendBase = resolvePortalFrontendUrl(
      config,
      PortalType.APPRENTICE,
    );
    const packPageUrl = frontendBase
      ? `${frontendBase.replace(/\/$/, '')}/epa-pack`
      : '';

    return new EpaPackReadyEmail(params.to, {
      firstName: params.firstName,
      downloadUrl: params.downloadUrl,
      expiresInLabel: formatTokenTtlLabel(ttlSeconds),
      expiresAtLabel: formatExpiry(params.expiresAt),
      packPageUrl,
    });
  }

  getTemplateContext(): Record<string, unknown> {
    return { ...this.templateContext };
  }
}

/** UK time: the reader is in the UK, and an expiry is a clock time to them. */
function formatExpiry(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
