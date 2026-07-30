import { ApiProperty } from '@nestjs/swagger';

import { ApprenticeStatus } from '../enums/apprentice-status.enum.js';

export class ApprenticeResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organisationId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({
    nullable: true,
    example: 'EMP-04821',
    description: "The employer's own payroll or staff reference",
  })
  employeeId!: string | null;

  @ApiProperty({ enum: ApprenticeStatus })
  status!: ApprenticeStatus;
}
