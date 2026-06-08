import { ApiProperty } from '@nestjs/swagger';

import type {
  IlrValidationIssue,
  IlrValidationSummary,
} from '../types/ilr-mapping-config.types.js';

export class IlrValidationReportResponseDto {
  @ApiProperty({ type: 'array', items: { type: 'object' } })
  issues!: IlrValidationIssue[];

  @ApiProperty()
  summary!: IlrValidationSummary;

  @ApiProperty()
  isValid!: boolean;
}
