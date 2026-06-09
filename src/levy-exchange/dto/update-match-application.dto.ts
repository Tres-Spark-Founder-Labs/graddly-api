import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

import { LevyMatchApplicationStatus } from '../enums/levy-match-application-status.enum.js';

export class UpdateMatchApplicationDto {
  @ApiProperty({
    enum: [
      LevyMatchApplicationStatus.CONFIRMED,
      LevyMatchApplicationStatus.REJECTED,
    ],
    description: 'Donor decision on a pending application',
  })
  @IsIn([
    LevyMatchApplicationStatus.CONFIRMED,
    LevyMatchApplicationStatus.REJECTED,
  ])
  status!:
    | LevyMatchApplicationStatus.CONFIRMED
    | LevyMatchApplicationStatus.REJECTED;
}
