import { Module } from '@nestjs/common';
import { CreatorModule } from '../creator/creator.module';
import { OrganisationModule } from '../organisation/organisation.module';
import { AdminPaymentsController } from './admin-payments.controller';
import { BrandPaymentsController } from './brand-payments.controller';
import { CreatorPaymentsController } from './creator-payments.controller';
import { DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';
import { DocumentsService } from './documents.service';
import { PayoutAccountService } from './payout-account.service';
import { PayoutService } from './payout.service';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [OrganisationModule, CreatorModule],
  controllers: [
    WalletController,
    CreatorPaymentsController,
    BrandPaymentsController,
    DisputesController,
    WebhooksController,
    AdminPaymentsController,
  ],
  providers: [
    WalletService,
    PayoutAccountService,
    PayoutService,
    DisputesService,
    DocumentsService,
    WebhooksService,
  ],
  exports: [WalletService, PayoutService],
})
export class PaymentsModule {}
