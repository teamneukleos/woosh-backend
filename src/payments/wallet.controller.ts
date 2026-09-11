import { BadRequestException, Body, Controller, Get, Headers, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequirePermission } from '../organisation/decorators/require-permission.decorator';
import { WorkspaceGuard } from '../organisation/guards/workspace.guard';
import { WorkspaceService } from '../organisation/workspace.service';
import { WalletTopUpDto, VerifyTopUpDto } from './dto/top-up.dto';
import { WalletService } from './wallet.service';

@ApiTags('wallet')
@ApiBearerAuth('access-token')
@ApiHeader({ name: 'X-Brand-Id', required: false })
@UseGuards(JwtAuthGuard, WorkspaceGuard)
@Controller('wallet')
export class WalletController {
  constructor(
    private readonly wallets: WalletService,
    private readonly workspace: WorkspaceService,
  ) {}

  @Get()
  @RequirePermission('analytics.view')
  @ApiOperation({
    summary: 'Brand wallet balance',
    description: 'One wallet per brand. Agency money never crosses Brand rows.',
  })
  async balance(
    @CurrentUser() user: { id: string },
    @Query('brandId') brandId?: string,
    @Headers('x-brand-id') headerBrandId?: string,
  ) {
    const id = headerBrandId || brandId;
    if (!id) throw new BadRequestException('Select a brand first (brandId or X-Brand-Id).');
    await this.workspace.requireBrandAccess(user.id, id);
    return this.wallets.getBalance(id);
  }

  @Post('top-up')
  @RequirePermission('payments.approve')
  @ApiOperation({
    summary: 'Top up the active brand wallet',
    description:
      'Without Paystack keys this credits immediately (refused in production). With Paystack it returns an authorization URL; charge.success credits via POST /payments/webhooks/paystack.',
  })
  async topUp(
    @CurrentUser() user: { id: string; email: string },
    @Body() body: WalletTopUpDto,
    @Query('brandId') brandId?: string,
    @Headers('x-brand-id') headerBrandId?: string,
  ) {
    const id = headerBrandId || brandId;
    if (!id) {
      throw new BadRequestException('Select a brand first (brandId or X-Brand-Id).');
    }
    await this.workspace.requireBrandPermission(user.id, id, 'payments.approve');
    return this.wallets.startTopUp({
      brandId: id,
      amount: body.amount,
      actorUserId: user.id,
      actorEmail: user.email,
    });
  }

  @Post('verify-top-up')
  @RequirePermission('payments.approve')
  @ApiOperation({
    summary: 'Confirm a Paystack wallet top-up after checkout',
    description:
      'Verifies the charge with Paystack, then credits that brand wallet. Used when the browser returns from checkout (webhooks still credit in production).',
  })
  verifyTopUp(
    @CurrentUser() user: { id: string },
    @Body() body: VerifyTopUpDto,
  ) {
    return this.wallets.completeTopUpFromPaystack(user.id, body.reference);
  }
}
