import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CounterOfferDto } from './dto/counter-offer.dto';
import { WithdrawApplicationDto } from './dto/withdraw.dto';
import { SelectionService } from './selection.service';

@ApiTags('applications')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly selection: SelectionService) {}

  @Post(':id/shortlist')
  @ApiOperation({ summary: 'Shortlist an application (brand)' })
  shortlist(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.selection.shortlist(user.id, id);
  }

  @Post(':id/decline')
  @ApiOperation({ summary: 'Decline an application (brand)' })
  decline(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.selection.decline(user.id, id);
  }

  @Post(':id/accept')
  @ApiOperation({
    summary: 'Accept a creator (fund-before-select)',
    description:
      'Locks the agreed rate from the brand wallet into a COMMITTED obligation. Platform fee is 0%. Fails and rolls back if the wallet cannot cover the creator rate. If offers exist, one must be AGREED first.',
  })
  accept(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.selection.accept(user.id, id);
  }

  @Post(':id/withdraw')
  @ApiOperation({ summary: 'Withdraw an application (creator)' })
  withdraw(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: WithdrawApplicationDto,
  ) {
    return this.selection.withdraw(user.id, id, body.reason);
  }

  @Post(':id/offers')
  @ApiOperation({
    summary: 'Counter-offer on an application',
    description: 'Either side may counter. You cannot counter your own latest open offer.',
  })
  counter(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: CounterOfferDto,
  ) {
    return this.selection.counterOffer(user.id, id, body.amount, body.message);
  }
}
