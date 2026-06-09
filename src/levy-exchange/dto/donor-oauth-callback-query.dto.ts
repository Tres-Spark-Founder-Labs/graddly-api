import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class DonorOAuthCallbackQueryDto {
  @ApiProperty({ description: 'Authorization code returned by ESFA DAS OAuth' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty({
    description: 'Signed state tying link, organisation, and user',
  })
  @IsString()
  @IsNotEmpty()
  state!: string;
}
