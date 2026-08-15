import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TransferEnrolmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  transferId!: string;

  @ApiProperty({ format: 'uuid' })
  enrolmentId!: string;

  @ApiProperty({ format: 'uuid' })
  donorOrganisationId!: string;

  @ApiPropertyOptional({
    nullable: true,
    example: '21000.00',
    description:
      'Amount attributed to this enrolment; null when the transfer was not apportioned.',
  })
  attributedAmount!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
