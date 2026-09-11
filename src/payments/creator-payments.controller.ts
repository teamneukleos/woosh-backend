import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreatorGuard } from '../creator/creator.guard';
import { CurrentCreatorId } from '../creator/current-creator.decorator';
import { CreateStatementDto } from './dto/create-statement.dto';
import { SavePayoutAccountDto } from './dto/save-payout-account.dto';
import { DocumentsService } from './documents.service';
import { PayoutAccountService } from './payout-account.service';
import { PayoutService } from './payout.service';

@ApiTags('creator')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, CreatorGuard)
@Controller('creators/me')
export class CreatorPaymentsController {
  constructor(
    private readonly accounts: PayoutAccountService,
    private readonly payouts: PayoutService,
    private readonly documents: DocumentsService,
  ) {}

  @Get('payout-banks')
  @ApiOperation({
    summary: 'Nigerian banks for payout accounts',
    description: 'Uses Paystack when configured. Local development returns a short NUBAN list.',
  })
  banks() {
    return this.accounts.listBanks();
  }

  @Get('payout-account')
  @ApiOperation({
    summary: 'Own verified payout account',
    description: 'Never returns the full account number — last4 and bank name only.',
  })
  getAccount(@CurrentCreatorId() creatorProfileId: string) {
    return this.accounts.getMine(creatorProfileId);
  }

  @Post('payout-account')
  @ApiOperation({
    summary: 'Verify and save a NUBAN payout account',
    description:
      '10-digit NUBAN is encrypted at rest. With Paystack keys, resolve + transfer recipient are created. Without keys, a development recipient is stored.',
  })
  saveAccount(
    @CurrentCreatorId() creatorProfileId: string,
    @CurrentUser() user: { id: string },
    @Body() body: SavePayoutAccountDto,
  ) {
    return this.accounts.verifyAndSave({
      creatorProfileId,
      actorUserId: user.id,
      bankCode: body.bankCode,
      accountNumber: body.accountNumber,
    });
  }

  @Get('earnings')
  @ApiOperation({
    summary: 'Own payment obligations',
    description: 'Platform fee is always 0% of the creator rate.',
  })
  earnings(@CurrentCreatorId() creatorProfileId: string) {
    return this.payouts.listCreatorEarnings(creatorProfileId);
  }

  @Get('documents')
  @ApiOperation({ summary: 'Own statements and payout receipts' })
  documentsList(@CurrentCreatorId() creatorProfileId: string) {
    return this.documents.listCreator(creatorProfileId);
  }

  @Post('statements')
  @ApiOperation({
    summary: 'Generate a monthly creator statement',
    description: 'UTC calendar month of PAID obligations. Regenerating the same month updates totals.',
  })
  createStatement(
    @CurrentCreatorId() creatorProfileId: string,
    @Body() body: CreateStatementDto,
  ) {
    return this.documents.createCreatorStatement(
      creatorProfileId,
      body.year,
      body.month,
    );
  }
}
