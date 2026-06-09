import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, MaxLength } from 'class-validator';

import { LevyTransferParty } from '../enums/levy-transfer-party.enum.js';

export class SignTransferDto {
  @ApiProperty({
    enum: LevyTransferParty,
    description: 'Signing party: donor signs first, then recipient',
  })
  @IsEnum(LevyTransferParty)
  party!: LevyTransferParty;

  @ApiProperty({
    example: 'orgs/uuid/signature/obj/signature.png',
    description: 'Org-scoped storage key for the signature image PNG',
  })
  @IsString()
  @MaxLength(1024)
  signatureImageKey!: string;
}
