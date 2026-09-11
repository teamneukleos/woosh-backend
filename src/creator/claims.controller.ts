import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ClaimService } from './claim.service';
import { ClaimRegisterDto } from './dto/claim-register.dto';

@ApiTags('claims')
@Controller('creators/claims')
export class ClaimsController {
  constructor(private readonly claims: ClaimService) {}

  @Get(':token')
  @ApiOperation({
    summary: 'Preview a claim invite (public)',
    description: 'Paste the token from the Nest console. Does not reveal the brand teammate email.',
  })
  async preview(@Param('token') token: string) {
    const claim = await this.claims.getByToken(token);
    if (!claim) throw new NotFoundException('Invite not found.');
    return claim;
  }

  @Post(':token/register')
  @ApiOperation({
    summary: 'Register as a creator and claim the prospect',
    description:
      'If the prospect has a contactEmail, it must match and the account is verified. The social handle is attached as PENDING until OAuth.',
  })
  register(@Param('token') token: string, @Body() body: ClaimRegisterDto) {
    return this.claims.registerAndClaim(token, body);
  }

  @Post(':token/accept')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Claim the prospect with a signed-in account',
    description: 'Creates a creator profile if this user does not have one. Handle stays PENDING.',
  })
  accept(@Param('token') token: string, @CurrentUser() user: { id: string }) {
    return this.claims.accept(token, user.id);
  }
}
