import { ApiProperty } from '@nestjs/swagger';

export class MfaConfirmResponseDto {
  @ApiProperty({
    example: ['a1b2c3d4e5', 'f6g7h8i9j0'],
    description:
      'One-time recovery codes, shown once. Each can be used in place of a TOTP code if the authenticator device is lost; store them safely.',
    type: [String],
  })
  recoveryCodes!: string[];
}
