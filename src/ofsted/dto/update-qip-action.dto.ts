import { PartialType } from '@nestjs/swagger';

import { CreateQipActionDto } from './create-qip-action.dto.js';

export class UpdateQipActionDto extends PartialType(CreateQipActionDto) {}
