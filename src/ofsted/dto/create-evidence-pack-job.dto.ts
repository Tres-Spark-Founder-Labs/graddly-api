import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class CreateEvidencePackJobDto {
  @ApiPropertyOptional({
    type: [String],
    description:
      'Optional org-scoped storage keys to include under custom/ in the ZIP. ' +
      'Each key must belong to the active organisation.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  additionalStorageKeys?: string[];
}
