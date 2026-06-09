import { ApiProperty } from '@nestjs/swagger';

import { MatchResultDto } from './match-result.dto.js';

export class SearchMatchesResponseDto {
  @ApiProperty({ type: [MatchResultDto] })
  matches!: MatchResultDto[];

  @ApiProperty({
    description:
      'True when no matches were found and the org was added to the waiting pool',
  })
  addedToWaitingPool!: boolean;
}
