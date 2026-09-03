import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Payloads for `/das/manual/*`.
 *
 * ── WHY THE MONEY FIELDS ARE STRINGS ────────────────────────────────────────
 *
 * Every amount here is `numeric(14,2)` in Postgres and a string in the
 * entities. Accepting a JavaScript number would round £10,000,000.05 on the way
 * in, and a levy balance is a figure employers commit money against. The regex
 * below is the validation; the string is carried through untouched.
 *
 * Negative amounts are permitted on funding payments only, because a clawback
 * is a real negative adjustment. A negative levy balance or tranche is not a
 * thing, and is rejected.
 */
const MONEY = /^-?\d{1,12}(\.\d{1,2})?$/;
const POSITIVE_MONEY = /^\d{1,12}(\.\d{1,2})?$/;

export class ManualLevyBalanceDto {
  @ApiProperty({
    example: '48250.00',
    description: 'Available levy balance in GBP. Up to two decimal places.',
  })
  @IsString()
  @Matches(POSITIVE_MONEY, {
    message:
      'balance must be a positive amount with at most two decimal places, e.g. "48250.00"',
  })
  balance!: string;

  @ApiPropertyOptional({ example: 'GBP', default: 'GBP' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter code' })
  currency?: string;

  @ApiPropertyOptional({
    example: 'MDAS-11223344',
    description: 'The DAS account this balance belongs to, if known.',
  })
  @IsOptional()
  @IsString()
  accountId?: string;

  @ApiPropertyOptional({
    example: '10001234',
    description: 'UKPRN, if the organisation record does not already carry it.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/, { message: 'ukprn must be 8 digits' })
  ukprn?: string;
}

export class ManualLevyMonthlyRowDto {
  @ApiProperty({
    example: '2026-04',
    description: 'Month as YYYY-MM. Stored as the first of that month.',
  })
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'month must be YYYY-MM, e.g. "2026-04"',
  })
  month!: string;

  @ApiProperty({ example: '4100.00' })
  @IsString()
  @Matches(POSITIVE_MONEY, {
    message: 'contributions must be a positive amount, e.g. "4100.00"',
  })
  contributions!: string;

  @ApiProperty({ example: '2750.00' })
  @IsString()
  @Matches(POSITIVE_MONEY, {
    message: 'spend must be a positive amount, e.g. "2750.00"',
  })
  spend!: string;

  @ApiPropertyOptional({ example: 'GBP', default: 'GBP' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;
}

export class ManualLevyMonthlyDto {
  /**
   * Up to twelve months, and they must be CONTIGUOUS.
   *
   * Not "exactly twelve": an employer seven months into a levy year has seven,
   * and rejecting that would force whoever is entering the data to invent five.
   *
   * Contiguity is the rule instead, enforced in `DasManualService`. A gap at
   * either end is a levy year in progress, or one joined part-way through —
   * both real. A gap in the MIDDLE is a dropped row: a month where the employer
   * genuinely contributed nothing is `0.00`, which is expressible and
   * distinguishable from absent. Eleven months rendering as a twelve-month
   * trend is the failure this prevents.
   */
  @ApiProperty({
    type: [ManualLevyMonthlyRowDto],
    description:
      'Up to 12 contiguous months, oldest first. Gaps are allowed at either ' +
      'end (a year in progress) but not in the middle — enter 0.00 for a month ' +
      'with no contribution. REPLACES every monthly entry for the active ' +
      'organisation; this is not an upsert.',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'at least one month is required' })
  @ArrayMaxSize(12, { message: 'at most 12 months may be submitted' })
  @ValidateNested({ each: true })
  @Type(() => ManualLevyMonthlyRowDto)
  months!: ManualLevyMonthlyRowDto[];
}

export class ManualLevyTrancheRowDto {
  @ApiProperty({ example: '7800.00' })
  @IsString()
  @Matches(POSITIVE_MONEY, {
    message: 'amount must be a positive amount, e.g. "7800.00"',
  })
  amount!: string;

  @ApiProperty({
    example: '2027-04-30',
    description: 'The date this tranche expires, YYYY-MM-DD.',
  })
  @IsISO8601(
    { strict: true },
    { message: 'expiresOn must be a date, e.g. "2027-04-30"' },
  )
  expiresOn!: string;
}

export class ManualLevyTranchesDto {
  /**
   * Explicit, never inferred from the organisation.
   *
   * F4.1.1 AC4 allows a donor to link several DAS accounts for separate legal
   * entities in a group, so "the organisation's donor link" is not always
   * singular. Resolving it here would silently attach a group subsidiary's
   * tranches to whichever account happened to be found first.
   */
  @ApiProperty({
    format: 'uuid',
    description:
      'The donor link these tranches belong to. Required: an organisation may ' +
      'have several linked DAS accounts (F4.1.1 AC4). Create one first at ' +
      'POST /das/manual/donor-link.',
  })
  @IsString()
  @IsNotEmpty()
  donorLinkId!: string;

  @ApiProperty({
    type: [ManualLevyTrancheRowDto],
    description:
      'REPLACES every tranche on this donor link — not an upsert. Tranches on ' +
      "the organisation's other donor links are untouched.",
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManualLevyTrancheRowDto)
  tranches!: ManualLevyTrancheRowDto[];
}

export class ManualFundingPaymentDto {
  @ApiProperty({
    example: 'MDAS-PAY-2026-04',
    description: 'The ESFA payment reference. Unique per organisation.',
  })
  @IsString()
  @IsNotEmpty()
  externalReference!: string;

  @ApiProperty({ example: '2026-04-15' })
  @IsISO8601({ strict: true })
  paymentDate!: string;

  @ApiProperty({
    example: '1250.00',
    description:
      'Negative for a clawback, which is a real ESFA adjustment rather than ' +
      'a data-entry error.',
  })
  @IsString()
  @Matches(MONEY, {
    message: 'amount must be a number with at most two decimal places',
  })
  amount!: string;

  @ApiPropertyOptional({ example: 'GBP', default: 'GBP' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @ApiPropertyOptional({ example: '2026-27' })
  @IsOptional()
  @IsString()
  fundingPeriod?: string;

  /**
   * Required when `amount` is negative — enforced in `DasManualService`.
   *
   * ── DELIBERATELY NOT SYMMETRIC WITH THE SYNCED PATH ─────────────────────
   *
   * `das-funding-sync.service.ts` does NOT apply this rule, and should not.
   * That path records what the ESFA sends; a clawback arriving over the API
   * with no explanation is still a real movement of money, and rejecting it
   * would mean the platform's payment history disagrees with the ESFA's.
   *
   * The rule belongs here because this path has a person on the other end who
   * knows why the money went back and can be asked. Do not "fix" the asymmetry
   * by adding the check to the sync service — that would discard real ESFA
   * data to satisfy a validation rule written for typed input.
   */
  @ApiPropertyOptional({
    description:
      'Why the amount was recovered. Required when the amount is negative. ' +
      'Not required on payments synced from the ESFA, which are recorded as ' +
      'sent.',
  })
  @IsOptional()
  @IsString()
  clawbackNotice?: string;
}

export class ManualIlrReceiptDto {
  @ApiProperty({
    format: 'uuid',
    description: 'The ILR submission this receipt belongs to.',
  })
  @IsString()
  @IsNotEmpty()
  submissionId!: string;

  @ApiProperty({
    example: 'ESFA-2026-000123',
    description: 'The reference the ESFA returned for the submission.',
  })
  @IsString()
  @IsNotEmpty()
  esfaReference!: string;

  @ApiProperty({
    example: '2026-04-16T09:30:00.000Z',
    description: 'When the ESFA accepted it, not when this was typed in.',
  })
  @IsISO8601({ strict: true })
  submittedAt!: string;
}

export class ManualDonorLinkDto {
  @ApiProperty({
    example: 'Meridian Engineering — main levy account',
    description:
      'How the operator will recognise this account. Shown wherever a link ' +
      'has to be chosen, so it should distinguish one legal entity from another.',
  })
  @IsString()
  @IsNotEmpty()
  label!: string;

  @ApiPropertyOptional({ example: 'MDAS-11223344' })
  @IsOptional()
  @IsString()
  dasAccountId?: string;

  @ApiPropertyOptional({ example: '10001234' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/, { message: 'ukprn must be 8 digits' })
  ukprn?: string;

  @ApiPropertyOptional({
    example: '48250.00',
    description:
      'The balance on this account, if known. Left absent rather than zeroed ' +
      'when it is not.',
  })
  @IsOptional()
  @IsString()
  @Matches(POSITIVE_MONEY)
  lastBalance?: string;
}

/** Query for listing donor links, so the screen can offer a choice. */
export class ListManualDonorLinksQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  perPage?: number;
}
