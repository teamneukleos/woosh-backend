import { BadRequestException, Body, Controller, Get, Headers, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequirePermission } from '../organisation/decorators/require-permission.decorator';
import { WorkspaceGuard } from '../organisation/guards/workspace.guard';
import { WorkspaceService } from '../organisation/workspace.service';
import { CreateDvaDto } from './dto/dva.dto';
import { WalletTopUpDto, VerifyTopUpDto } from './dto/top-up.dto';
import { listPaystackBanks, paystackConfigured } from './paystack.client';
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

  @Get('dva')
  @RequirePermission('payments.approve')
  @ApiOperation({
    summary: 'Dedicated virtual account for this brand wallet',
    description:
      'One NUBAN per Brand. Created lazily on POST /wallet/dva. Null until then.',
  })
  async dva(
    @CurrentUser() user: { id: string },
    @Query('brandId') brandId?: string,
    @Headers('x-brand-id') headerBrandId?: string,
  ) {
    const id = headerBrandId || brandId;
    if (!id) throw new BadRequestException('Select a brand first (brandId or X-Brand-Id).');
    await this.workspace.requireBrandPermission(user.id, id, 'payments.approve');
    const wallet = await this.wallets.getBalance(id);
    return { dva: wallet.dva };
  }

  @Post('dva')
  @RequirePermission('payments.approve')
  @ApiOperation({
    summary: 'Create a dedicated NUBAN for this brand (bank transfer)',
    description:
      'Lazy, per Brand. Phone and legal name required. BVN is only collected if Paystack requires customer identification, and is never stored.',
  })
  async createDva(
    @CurrentUser() user: { id: string; email: string },
    @Body() body: CreateDvaDto,
    @Query('brandId') brandId?: string,
    @Headers('x-brand-id') headerBrandId?: string,
  ) {
    const id = headerBrandId || brandId;
    if (!id) throw new BadRequestException('Select a brand first (brandId or X-Brand-Id).');
    await this.workspace.requireBrandPermission(user.id, id, 'payments.approve');
    return this.wallets.getOrCreateDva({
      brandId: id,
      actorUserId: user.id,
      actorEmail: user.email,
      firstName: body.firstName,
      lastName: body.lastName,
      phone: body.phone,
      consent: body.consent,
      bvn: body.bvn,
      accountNumber: body.accountNumber,
      bankCode: body.bankCode,
    });
  }

  @Get('dva-banks')
  @RequirePermission('payments.approve')
  @ApiOperation({ summary: 'Banks for BVN identification when Paystack requires it' })
  async dvaBanks() {
    if (!paystackConfigured()) {
      return {
        banks: [
          { name: 'Access Bank', code: '044' },
          { name: 'Guaranty Trust Bank', code: '058' },
          { name: 'Zenith Bank', code: '057' },
        ],
      };
    }
    const banks = await listPaystackBanks();
    return {
      banks: banks
        .filter((bank) => bank.active)
        .map((bank) => ({ name: bank.name, code: bank.code })),
    };
  }
}
