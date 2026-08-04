import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

/**
 * F2.4.3 AC2 — the unauthenticated response body.
 *
 * Loosely typed on purpose: the valid keys and value ranges depend on the
 * campaign's own frozen questions, which no static decorator can know. The
 * service validates against them and rejects anything out of range.
 */
export class SubmitSurveyResponseDto {
  @ApiProperty({
    type: Object,
    description: 'questionId → answer. Numbers for scales, strings for text.',
    example: { q1: 5, q2: 9, q3: 'Communication has been excellent.' },
  })
  @IsObject()
  answers!: Record<string, number | string>;
}
