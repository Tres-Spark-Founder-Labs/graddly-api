import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webpush from 'web-push';

/** What a push service said. Only the status matters to the caller. */
export interface IWebPushResult {
  statusCode: number;
}

/**
 * The one place the `web-push` library is called, so the send path can be
 * tested with a double and the VAPID details are set exactly once.
 *
 * `send` rejects with the library's WebPushError on a non-2xx response; the
 * caller reads `statusCode` off it to tell "this endpoint is gone" (404, 410)
 * from everything else.
 */
@Injectable()
export class WebPushClient {
  private configured = false;

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return this.config.get<boolean>('app.webPush.enabled', false);
  }

  publicKey(): string | null {
    return this.isEnabled()
      ? this.config.get<string>('app.webPush.vapidPublicKey', '')
      : null;
  }

  async send(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
  ): Promise<IWebPushResult> {
    if (!this.configured) {
      webpush.setVapidDetails(
        this.config.get<string>('app.webPush.vapidSubject', ''),
        this.config.get<string>('app.webPush.vapidPublicKey', ''),
        this.config.get<string>('app.webPush.vapidPrivateKey', ''),
      );
      this.configured = true;
    }
    const result = await webpush.sendNotification(subscription, payload, {
      // A nudge, not a message: if the device is off for a day it is stale.
      // eslint-disable-next-line @typescript-eslint/naming-convention -- web-push's option name
      TTL: 24 * 60 * 60,
      urgency: 'normal',
    });
    return { statusCode: result.statusCode };
  }
}
