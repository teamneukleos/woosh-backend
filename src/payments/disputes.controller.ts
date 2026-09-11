import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OpenDisputeDto } from './dto/open-dispute.dto';
import { DisputesService } from './disputes.service';

@ApiTags('disputes')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('disputes')
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Get()
  @ApiOperation({
    summary: 'Disputes visible to this seat',
    description: 'Creators see their earnings disputes. Brands see their brand rows only. Admins see all.',
  })
  list(@CurrentUser() user: { id: string }) {
    return this.disputes.listForUser(user.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Open a payment dispute',
    description:
      'Allowed on APPROVED or FAILED during the 72-hour window. PAYOUT_DELAY can be opened after the window. Freezes the obligation until admin resolve.',
  })
  open(@CurrentUser() user: { id: string }, @Body() body: OpenDisputeDto) {
    return this.disputes.open({
      actorUserId: user.id,
      obligationId: body.obligationId,
      category: body.category,
      subject: body.subject,
      description: body.description,
      requestedResolution: body.requestedResolution,
    });
  }
}
