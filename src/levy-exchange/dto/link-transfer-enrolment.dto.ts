import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

/**
 * F4.1.4 AC1 — record that a transfer funded a particular enrolment.
 *
 * Called by the provider who owns the enrolment, which is also what the
 * row-level security insert policy enforces: a donor cannot attribute learners
 * to their own transfer, because the resulting count is published.
 */
export class LinkTransferEnrolmentDto {
  @ApiProperty({
    format: 'uuid',
    description: 'The enrolment this transfer paid for',
  })
  @IsUUID()
  enrolmentId!: string;

  /**
   * Optional on purpose. A transfer that funded three learners has not
   * necessarily been split evenly between them, and this API will not guess:
   * an unset value records "this transfer funded this enrolment" without
   * asserting an amount that would flow into a published funding figure.
   */
  @ApiPropertyOptional({
    description:
      'Amount of the transfer attributed to this enrolment. Omit when the ' +
      'transfer has not been apportioned — no figure is inferred.',
    example: 21000,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  attributedAmount?: number;
}
