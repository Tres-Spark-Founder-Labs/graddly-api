import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsUUID,
  ValidateIf,
} from 'class-validator';

/**
 * F2.2.5 AC1 — "tutor assignment can be set per learner or in bulk for a
 * cohort".
 */
export class BulkAssignTutorDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description:
      'Enrolments to reassign. Ids outside this provider are ignored.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  enrolmentIds!: string[];

  /**
   * Explicitly nullable, and that is a feature.
   *
   * Un-assigning is a real action — a tutor leaves and their caseload has to
   * go somewhere visible before it is redistributed. Sending `null` puts those
   * learners in the "Unassigned" row of the dashboard, where they are the most
   * urgent thing on the screen, rather than quietly staying with someone who
   * has left.
   */
  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Null un-assigns, moving these learners to the Unassigned row.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  tutorUserId?: string | null;
}
