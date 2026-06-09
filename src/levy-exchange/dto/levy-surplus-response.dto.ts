import { ApiProperty } from '@nestjs/swagger';

export class LevySurplusResponseDto {
  @ApiProperty()
  donorLinkId!: string;

  @ApiProperty({ nullable: true })
  donorLinkLabel!: string | null;

  @ApiProperty()
  totalBalance!: string;

  @ApiProperty()
  committedToOwnApprenticeships!: string;

  @ApiProperty()
  maxTransferable!: string;

  @ApiProperty()
  alreadyTransferred!: string;

  @ApiProperty()
  availableSurplus!: string;

  @ApiProperty({ nullable: true })
  computedAt!: string | null;
}
