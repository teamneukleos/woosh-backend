import { Module } from '@nestjs/common';
import { OrganisationModule } from '../organisation/organisation.module';
import { PaymentsModule } from '../payments/payments.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { CampaignAccessService } from './access.service';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { ConversationsController } from './conversations.controller';
import { DeliverablesController } from './deliverables.controller';
import { DeliverablesService } from './deliverables.service';
import { MessagingService } from './messaging.service';

@Module({
  imports: [OrganisationModule, PaymentsModule, AnalyticsModule],
  controllers: [CampaignsController, DeliverablesController, ConversationsController],
  providers: [
    CampaignAccessService,
    CampaignsService,
    DeliverablesService,
    MessagingService,
  ],
})
export class CampaignModule {}
