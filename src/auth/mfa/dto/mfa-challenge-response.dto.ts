import { ApiProperty } from '@nestjs/swagger';

/** Returned by POST /auth/login instead of tokens when the account has MFA enabled. */
export class MfaChallengeResponseDto {
  @ApiProperty({ example: true })
  mfaRequired!: true;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description:
      'Short-lived token identifying this login attempt. Submit it with a TOTP or recovery code to POST /auth/mfa/verify to complete login.',
  })
  challengeToken!: string;
}
