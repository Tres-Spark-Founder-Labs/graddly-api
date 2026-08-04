import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class ListEmployerVisitsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Restrict to one employer — the employer profile view.',
  })
  @IsOptional()
  @IsUUID()
  employerOrganisationId?: string;
}
