import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class SearchMatchesDto {
  @ApiPropertyOptional({
    description: 'Override max results (capped by rules config)',
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
