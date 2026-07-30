import { ApiProperty } from '@nestjs/swagger';

export class MfaEnrollResponseDto {
  @ApiProperty({
    example: 'JBSWY3DPEHPK3PXP',
    description:
      'Base32 TOTP secret for manual entry when the authenticator app cannot scan a QR code',
  })
  secret!: string;

  @ApiProperty({
    example:
      'otpauth://totp/Graddly:jane%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Graddly',
    description:
      'otpauth:// provisioning URI — render as a QR code for the authenticator app to scan',
  })
  otpauthUrl!: string;
}
