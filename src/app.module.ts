import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnalyticsModule } from './analytics/analytics.module';
import { CampaignModule } from './campaign/campaign.module';
import { CreatorModule } from './creator/creator.module';
import { HealthController } from './health.controller';
import { IdentityModule } from './identity/identity.module';
import { JobsModule } from './jobs/jobs.module';
import { MailModule } from './mail/mail.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrganisationModule } from './organisation/organisation.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    MailModule,
    StorageModule,
    IdentityModule,
    OrganisationModule,
    CreatorModule,
    PaymentsModule,
    MarketplaceModule,
    CampaignModule,
    AnalyticsModule,
    NotificationsModule,
    JobsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
