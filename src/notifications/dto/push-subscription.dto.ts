import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** The `keys` object of a browser's `PushSubscription.toJSON()`. */
export class PushSubscriptionKeysDto {
  @ApiProperty({ description: 'P-256 ECDH public key, base64url.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  p256dh!: string;

  @ApiProperty({ description: 'Authentication secret, base64url.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  auth!: string;
}

/**
 * POST /notifications/push-subscriptions — exactly the shape
 * `PushSubscription.toJSON()` produces in the browser, so the client sends it
 * unchanged.
 */
export class CreatePushSubscriptionDto {
  @ApiProperty({
    description: 'The push service URL for this browser.',
    example: 'https://fcm.googleapis.com/fcm/send/…',
  })
  // eslint-disable-next-line @typescript-eslint/naming-convention -- class-validator's option name
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  endpoint!: string;

  @ApiProperty({ type: PushSubscriptionKeysDto })
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys!: PushSubscriptionKeysDto;
}

export class PushSubscriptionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  endpoint!: string;

  @ApiPropertyOptional({ nullable: true })
  userAgent!: string | null;

  @ApiProperty()
  createdAt!: string;
}

/**
 * GET /notifications/push-subscriptions/public-key. `publicKey` is null when
 * the server has no VAPID keys, in which case a browser must not subscribe.
 */
export class PushPublicKeyResponseDto {
  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'The VAPID public key to pass as applicationServerKey; null when web ' +
      'push is not configured on this server.',
  })
  publicKey!: string | null;
}
