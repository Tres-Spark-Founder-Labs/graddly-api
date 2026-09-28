import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuthResponseDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'Short-lived JWT access token (default 15 minutes)',
  })
  accessToken!: string;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Long-lived opaque refresh token (default 7 days)',
  })
  refreshToken!: string;

  /**
   * PRD §7.2 — MFA is compulsory for this account and it has not enrolled.
   *
   * Present and true only in that case. The tokens are real and are needed:
   * enrolment is itself an authenticated flow. Every other authenticated
   * route refuses the caller with `MFA_ENROLMENT_REQUIRED` until enrolment
   * completes, so a client seeing this should route straight to MFA setup
   * rather than to a dashboard it cannot load.
   */
  @ApiPropertyOptional({
    example: true,
    description:
      'True when the account must enrol in MFA before any other endpoint ' +
      'will serve it (provider and employer owners and admins).',
  })
  mfaEnrolmentRequired?: boolean;
}
