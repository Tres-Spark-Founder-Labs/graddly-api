import { ApiProperty } from '@nestjs/swagger';

export class RecipientProfileResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organisationId!: string;

  @ApiProperty()
  sector!: string;

  @ApiProperty()
  region!: string;

  @ApiProperty()
  employeeCountBand!: string;

  @ApiProperty()
  programmeType!: string;

  @ApiProperty({ example: '15000.00' })
  transferAmountRequired!: string;

  @ApiProperty()
  hasDasAccount!: boolean;

  @ApiProperty({
    description:
      'Whether this profile is opted in to the donor-facing directory',
  })
  isListed!: boolean;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}
