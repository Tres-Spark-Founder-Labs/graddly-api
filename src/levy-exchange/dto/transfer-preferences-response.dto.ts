import { ApiProperty } from '@nestjs/swagger';

export class TransferPreferencesResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organisationId!: string;

  @ApiProperty({ type: [String] })
  sectors!: string[];

  @ApiProperty({ type: [String] })
  regions!: string[];

  @ApiProperty({ type: [String] })
  sizeBands!: string[];

  @ApiProperty({ type: [String] })
  programmeTypes!: string[];

  @ApiProperty({ nullable: true, example: '25000.00' })
  maxPerRecipient!: string | null;

  @ApiProperty()
  openMatching!: boolean;

  @ApiProperty()
  anonymousMatching!: boolean;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}
