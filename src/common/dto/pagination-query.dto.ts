import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Shared pagination query, used by every paginated endpoint on the platform.
 *
 * THE SWAGGER DECORATORS ARE LOad-BEARING, not decoration.
 *
 * Without them the CLI plugin had nothing to reflect but the initializer.
 * `page = 1` carries no type annotation, so the emitted schema became
 * `allOf: [$ref: '#/components/schemas/Object']` and — because an initializer
 * without `?` reads as non-optional — `required: true`.
 *
 * Every generated client therefore typed pagination as
 * `page: Record<string, never>`, mandatory and unusable, on every paginated
 * route in the API. Found by the item 8 type gate, which is exactly the sort
 * of contract defect it exists to surface: the API works fine, and anything
 * generated from its published description does not.
 *
 * The initializers stay, so runtime defaulting is unchanged — this is a
 * description fix, not a behaviour change.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    default: 1,
    description: 'One-based page number.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: 100,
    default: 20,
    description: 'Items per page.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  perPage = 20;
}
