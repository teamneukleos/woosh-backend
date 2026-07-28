import { Module } from '@nestjs/common';
import {
  SocialConnectionsController,
  SocialOAuthCallbackController,
} from './social-connections.controller';
import { OAuthStateService } from './oauth-state.service';
import { TokenCryptoService } from './token-crypto.service';
import { YouTubeService } from './youtube.service';

@Module({
  controllers: [
    SocialConnectionsController,
    SocialOAuthCallbackController,
  ],
  providers: [YouTubeService, OAuthStateService, TokenCryptoService],
  exports: [YouTubeService],
})
export class SocialConnectionsModule {}
