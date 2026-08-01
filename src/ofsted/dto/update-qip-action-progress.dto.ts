import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';

import { QipActionStatus } from '../enums/qip-action-status.enum.js';

/**
 * F2.1.2 — reporting progress on an action, as distinct from editing the plan.
 *
 * The two are different acts by different people. Deciding what the Quality
 * Improvement Plan *contains* — which weakness, who owns it, by when — is a
 * leadership judgement an inspector will read. Saying *"I have done my bit,
 * here is the evidence"* is the work itself, and the person who did it is the
 * right person to record it.
 *
 * `PATCH /qip-actions/:id` accepts every field, so guarding it widely would
 * let a tutor rewrite the plan and guarding it narrowly locks them out of
 * their own actions. This DTO is the narrow half: status, notes and
 * attachments only. Title, owner, target date and linked criterion cannot be
 * reached through it, which is what makes the wider capability safe to grant.
 */
export class UpdateQipActionProgressDto {
  @ApiPropertyOptional({
    enum: QipActionStatus,
    description: 'Progress on the action.',
  })
  @IsOptional()
  @IsEnum(QipActionStatus)
  status?: QipActionStatus;

  @ApiPropertyOptional({
    description: 'Free-text notes about evidence gathered for this action.',
  })
  @IsOptional()
  @IsString()
  evidenceNotes?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Org-scoped storage keys for supporting documents (F2.1.2 AC6).',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenceAttachmentKeys?: string[];
}
