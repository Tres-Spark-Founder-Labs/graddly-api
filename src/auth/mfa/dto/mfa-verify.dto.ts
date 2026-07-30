import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class MfaVerifyDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description:
      'Challenge token returned by POST /auth/login when MFA is required',
  })
  @IsUUID()
  challengeToken!: string;

  @ApiPropertyOptional({
    example: '123456',
    description:
      '6-digit code from the authenticator app. Provide either this or recoveryCode.',
  })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({
    example: 'a1b2c3d4e5',
    description:
      'A single-use recovery code, for when the authenticator device is unavailable. Provide either this or code.',
  })
  @IsOptional()
  @IsString()
  recoveryCode?: string;
}
