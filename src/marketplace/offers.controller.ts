import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SelectionService } from './selection.service';

@ApiTags('offers')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('offers')
export class OffersController {
  constructor(private readonly selection: SelectionService) {}

  @Post(':id/agree')
  @ApiOperation({
    summary: 'Agree the other party’s open offer',
    description: 'Does not hire. Brand still POSTs /applications/:id/accept, which funds the wallet first.',
  })
  agree(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.selection.agreeOffer(user.id, id);
  }
}
