import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class PatchSafeguardingChecklistItemDto {
  @ApiPropertyOptional({
    description:
      'S3 storage key for supporting evidence (must belong to the organisation)',
    example: 'orgs/uuid/ofsted/safeguarding/policy.pdf',
    maxLength: 512,
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  evidenceStorageKey?: string;
}
