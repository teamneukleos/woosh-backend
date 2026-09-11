import { Module } from '@nestjs/common';
import { OrganisationModule } from '../organisation/organisation.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { ClaimService } from './claim.service';
import { ClaimsController } from './claims.controller';
import { CreatorGuard } from './creator.guard';
import { CreatorMeController } from './creator-me.controller';
import { MediaService } from './media.service';
import { CreatorProfileService } from './profile.service';
import { SocialInstagramCallbackController, SocialOAuthCallbackController, SocialYoutubeCallbackController } from './social-oauth.callback.controller';
import { SocialOAuthService } from './social-oauth.service';
import { ComposioInstagramService } from './composio-instagram.service';
import { SupplyController } from './supply.controller';
import { SupplyService } from './supply.service';

@Module({
  imports: [OrganisationModule, AnalyticsModule],
  controllers: [
    CreatorMeController,
    ClaimsController,
    SupplyController,
    SocialOAuthCallbackController,
    SocialYoutubeCallbackController,
    SocialInstagramCallbackController,
  ],
  providers: [
    CreatorGuard,
    CreatorProfileService,
    MediaService,
    SocialOAuthService,
    ComposioInstagramService,
    SupplyService,
    ClaimService,
  ],
  exports: [CreatorGuard, MediaService, SocialOAuthService, SupplyService],
})
export class CreatorModule {}
