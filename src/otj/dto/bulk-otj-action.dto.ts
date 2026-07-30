import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

/**
 * F1.2.3 AC4 — bulk approve is available for up to 20 entries simultaneously.
 *
 * The cap is enforced here rather than in the client because the previous
 * limit was incidental: the approvals queue pages at 20, so a selection could
 * not exceed 20 by accident. Nothing stopped a direct API call from submitting
 * thousands of ids, and `bulkTransition` processes them one at a time within a
 * single request — so an unbounded array is an availability concern too, not
 * just a spec deviation.
 */
export const BULK_OTJ_ACTION_MAX_IDS = 20;

/** F1.2.3 AC3 — "minimum 10 characters". */
export const OTJ_REJECTION_REASON_MIN_LENGTH = 10;

class BulkOtjIdsDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    maxItems: BULK_OTJ_ACTION_MAX_IDS,
    description: `OTJ log entry ids to act on (max ${BULK_OTJ_ACTION_MAX_IDS}).`,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(BULK_OTJ_ACTION_MAX_IDS, {
    message: `ids must contain no more than ${BULK_OTJ_ACTION_MAX_IDS} entries`,
  })
  @IsUUID('4', { each: true })
  ids!: string[];
}

/** Approval carries no comment — only rejection requires one (AC3). */
export class BulkOtjApproveDto extends BulkOtjIdsDto {}

export class BulkOtjRejectDto extends BulkOtjIdsDto {
  /**
   * Mandatory, and mandatory *server-side*.
   *
   * The approvals UI already blocked submission under 10 characters with a
   * live counter, but that guard only ever existed in the browser: any direct
   * call to `POST /otj-log-entries/bulk-reject` could reject an apprentice's
   * work with no explanation at all. A rejection the apprentice cannot act on
   * is the specific outcome AC3 exists to prevent.
   *
   * Trimmed before validation so ten spaces cannot satisfy a ten-character
   * minimum.
   */
  @ApiProperty({
    minLength: OTJ_REJECTION_REASON_MIN_LENGTH,
    description:
      'Explanation shown to the apprentice. Required, minimum ' +
      `${OTJ_REJECTION_REASON_MIN_LENGTH} characters after trimming.`,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(OTJ_REJECTION_REASON_MIN_LENGTH, {
    message:
      'reason must be at least ' +
      `${OTJ_REJECTION_REASON_MIN_LENGTH} characters explaining the rejection`,
  })
  reason!: string;
}
