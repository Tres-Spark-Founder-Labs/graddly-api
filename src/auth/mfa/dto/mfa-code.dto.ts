import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

/** Shared shape for confirm/disable: a single 6-digit TOTP code from the authenticator app. */
export class MfaCodeDto {
  @ApiProperty({
    example: '123456',
    description: '6-digit code from the authenticator app',
  })
  @IsString()
  @Length(6, 6)
  code!: string;
}
