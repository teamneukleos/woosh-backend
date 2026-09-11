import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SendMessageDto } from './dto/work.dto';
import { MessagingService } from './messaging.service';

@ApiTags('conversations')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly messaging: MessagingService) {}

  @Get()
  @ApiOperation({ summary: 'Inbox: application, campaign, and support threads' })
  list(@CurrentUser() user: { id: string }) {
    return this.messaging.list(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Open a thread and mark inbound messages read' })
  get(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.messaging.get(user.id, id);
  }

  @Post(':id/messages')
  @ApiOperation({
    summary: 'Send an in-platform message',
    description: 'Rates stay on Offer objects, not free-text. Contact stays in-thread.',
  })
  send(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: SendMessageDto,
  ) {
    return this.messaging.send(user.id, id, body.body);
  }
}
