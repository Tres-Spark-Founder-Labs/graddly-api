import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SafeguardingChecklistItemResponseDto {
  @ApiProperty({ example: 'policy_published' })
  slug!: string;

  @ApiProperty({ example: 'Safeguarding policy published' })
  label!: string;

  @ApiProperty({
    description: 'Whether the checklist item has been marked complete',
    example: true,
  })
  completed!: boolean;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When the item was marked complete (UTC)',
  })
  completedAt!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Optional evidence file storage key',
    example: 'orgs/uuid/ofsted/safeguarding/policy.pdf',
  })
  evidenceStorageKey!: string | null;
}
