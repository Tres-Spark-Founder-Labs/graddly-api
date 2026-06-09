import { ApiProperty } from '@nestjs/swagger';

export class LevyExpiryCalendarTrancheDto {
  @ApiProperty()
  trancheId!: string;

  @ApiProperty()
  donorLinkId!: string;

  @ApiProperty({ nullable: true })
  donorLinkLabel!: string | null;

  @ApiProperty()
  amount!: string;

  @ApiProperty()
  expiresOn!: string;
}

export class LevyExpiryCalendarEntryDto {
  @ApiProperty({ example: '2026-09' })
  month!: string;

  @ApiProperty()
  totalAmount!: string;

  @ApiProperty({ type: [LevyExpiryCalendarTrancheDto] })
  tranches!: LevyExpiryCalendarTrancheDto[];
}
