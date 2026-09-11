import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { MarkNotificationsReadDto } from '../identity/dto/account.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List recent in-app notifications' })
  list(@CurrentUser() user: { id: string }) {
    return this.notifications.list(user.id);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Count unread in-app notifications' })
  async unreadCount(@CurrentUser() user: { id: string }) {
    return { unread: await this.notifications.unreadCount(user.id) };
  }

  @Post('read')
  @ApiOperation({ summary: 'Mark notifications as read (all, or the given ids)' })
  markRead(
    @CurrentUser() user: { id: string },
    @Body() body: MarkNotificationsReadDto,
  ) {
    return this.notifications.markRead(user.id, body.ids);
  }
}
