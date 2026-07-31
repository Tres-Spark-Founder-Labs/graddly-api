import { ApiProperty } from '@nestjs/swagger';

/**
 * F1.2.5 AC2 — "employer selects the training provider from a list of linked
 * providers (provider must have accepted connection request)".
 *
 * There is no organisation-level connection entity in this platform. What
 * exists is per-enrolment: an employer links a provider to an enrolment, and
 * the provider accepts it by advancing the pipeline to `provider_accepted`.
 *
 * That acceptance *is* the accepted connection request — so a "linked
 * provider" is derived as a provider organisation that has accepted at least
 * one enrolment from this employer, rather than by inventing a second,
 * parallel connection model that would then need keeping in step with the
 * enrolments it duplicates.
 */
export class LinkedProviderResponseDto {
  @ApiProperty({ format: 'uuid' })
  organisationId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({
    nullable: true,
    description: 'UK Provider Reference Number, when the provider has one set.',
  })
  ukprn!: string | null;

  @ApiProperty({
    description:
      'How many enrolments this provider has accepted from the employer. ' +
      'Lets the picker put familiar providers first.',
  })
  acceptedEnrolmentCount!: number;

  @ApiProperty({
    nullable: true,
    format: 'date-time',
    description: 'When the employer most recently enrolled with them.',
  })
  lastEnrolledAt!: string | null;
}
