import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class LookupCounterpartOrganisationQueryDto {
  @ApiProperty({
    example: '10012345',
    description:
      'Employer organisation UKPRN (8 digits). Used to resolve a counterpart employer for enrolment linking — not a directory browse.',
  })
  @Matches(/^\d{8}$/, { message: 'UKPRN must be exactly 8 digits' })
  ukprn!: string;
}
