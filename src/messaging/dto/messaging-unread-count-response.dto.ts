import { ApiProperty } from '@nestjs/swagger';

export class MessagingUnreadCountResponseDto {
  @ApiProperty({
    description: 'Total unread messages across all accessible threads',
    example: 5,
  })
  unreadCount!: number;
}
