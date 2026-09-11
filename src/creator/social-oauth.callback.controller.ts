import { Body, Controller, Get, Logger, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { OAuthCallbackDto } from './dto/oauth.dto';
import { instagramOAuthErrorCode, youtubeOAuthErrorCode } from './oauth-config';
import { SocialOAuthService } from './social-oauth.service';

@ApiTags('creator')
@Controller('creators/oauth')
export class SocialOAuthCallbackController {
  constructor(private readonly oauth: SocialOAuthService) {}

  @Post('callback')
  @ApiOperation({
    summary: 'Finish provider OAuth after the browser returns to Next',
    description:
      'Public: the signed state carries the creator. Next forwards code + state here for Instagram, TikTok, and the YouTube proxy path.',
  })
  callback(@Body() body: OAuthCallbackDto) {
    return this.oauth.completeCallback(body);
  }
}

@ApiTags('creator social OAuth callbacks')
@Controller('creators/social')
export class SocialYoutubeCallbackController {
  private readonly logger = new Logger(SocialYoutubeCallbackController.name);

  constructor(private readonly oauth: SocialOAuthService) {}

  @Get('youtube/callback')
  @ApiOperation({
    summary: 'Google YouTube OAuth callback',
    description:
      'Google calls this when GOOGLE_YOUTUBE_REDIRECT_URI points at Nest. The browser is then redirected to the frontend.',
  })
  async youtubeCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() response: Response,
  ) {
    if (error || !code || !state) {
      response.redirect(
        this.oauth.youtubeCallbackRedirect(
          'error',
          error ?? 'authorization_cancelled',
        ),
      );
      return;
    }

    try {
      await this.oauth.completeCallback({
        channel: 'YOUTUBE',
        code,
        state,
      });
      response.redirect(this.oauth.youtubeCallbackRedirect('connected'));
    } catch (callbackError) {
      this.logger.error('YouTube OAuth callback failed', callbackError);
      response.redirect(
        this.oauth.youtubeCallbackRedirect(
          'error',
          youtubeOAuthErrorCode(callbackError),
        ),
      );
    }
  }
}

@ApiTags('creator social OAuth callbacks')
@Controller('creators/social')
export class SocialInstagramCallbackController {
  private readonly logger = new Logger(SocialInstagramCallbackController.name);

  constructor(private readonly oauth: SocialOAuthService) {}

  @Get('instagram/callback')
  @ApiOperation({
    summary: 'Composio Instagram OAuth callback',
    description:
      'Composio calls this when COMPOSIO_INSTAGRAM_CALLBACK_URL points at Nest. The browser is then redirected to the frontend.',
  })
  async instagramCallback(
    @Query('state') state: string | undefined,
    @Query('connected_account_id') connectedAccountId: string | undefined,
    @Query('connectedAccountId') connectedAccountIdCamel: string | undefined,
    @Query('status') status: string | undefined,
    @Query('error') error: string | undefined,
    @Res() response: Response,
  ) {
    const accountId = connectedAccountId || connectedAccountIdCamel;
    const failedStatuses = [
      'failed',
      'FAILED',
      'EXPIRED',
      'cancelled',
      'CANCELLED',
      'error',
      'ERROR',
    ];
    const failed = Boolean(error) || (status ? failedStatuses.includes(status) : false);
    if (failed || !state || !accountId) {
      response.redirect(
        this.oauth.instagramCallbackRedirect(
          'error',
          error || (status && !accountId ? status : undefined) || 'authorization_cancelled',
        ),
      );
      return;
    }

    try {
      await this.oauth.completeCallback({
        channel: 'INSTAGRAM',
        state,
        connectedAccountId: accountId,
      });
      response.redirect(this.oauth.instagramCallbackRedirect('connected'));
    } catch (callbackError) {
      this.logger.error('Instagram OAuth callback failed', callbackError);
      response.redirect(
        this.oauth.instagramCallbackRedirect(
          'error',
          instagramOAuthErrorCode(callbackError),
        ),
      );
    }
  }
}
