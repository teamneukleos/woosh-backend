import { Module } from '@nestjs/common';
import { CreatorModule } from '../creator/creator.module';
import { OrganisationModule } from '../organisation/organisation.module';
import { PaymentsModule } from '../payments/payments.module';
import { AdminController } from './admin.controller';
import { AdminOpsService } from './admin.service';
import { ApplicationsController } from './applications.controller';
import { BriefsController } from './briefs.controller';
import { BriefsService } from './briefs.service';
import { JobsController } from './jobs.controller';
import { OffersController } from './offers.controller';
import { SelectionService } from './selection.service';

@Module({
  imports: [OrganisationModule, CreatorModule, PaymentsModule],
  controllers: [
    BriefsController,
    JobsController,
    ApplicationsController,
    OffersController,
    AdminController,
  ],
  providers: [BriefsService, SelectionService, AdminOpsService],
})
export class MarketplaceModule {}
