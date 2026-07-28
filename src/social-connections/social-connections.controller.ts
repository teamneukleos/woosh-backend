import {
  Controller,
  Delete,
  Get,
  Logger,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  AuthorizationUrlDto,
  SocialConnectionDto,
  SocialMessageDto,
} from './dto/social-connection.dto';
import { YouTubeService } from './youtube.service';

@ApiTags('creator social connections')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('creators/social')
export class SocialConnectionsController {
  constructor(private readonly youtube: YouTubeService) {}

  @Get()
  @ApiOperation({ summary: 'List the creator’s connected social accounts' })
  @ApiOkResponse({ type: SocialConnectionDto, isArray: true })
  list(@CurrentUser() user: AuthUser): Promise<SocialConnectionDto[]> {
    return this.youtube.list(user.id);
  }

  @Get('youtube/connect')
  @ApiOperation({
    summary: 'Start YouTube OAuth',
    description:
      'Returns a Google authorization URL. Redirect the creator’s browser to it.',
  })
  @ApiOkResponse({ type: AuthorizationUrlDto })
  connectYouTube(
    @CurrentUser() user: AuthUser,
  ): Promise<AuthorizationUrlDto> {
    return this.youtube.getAuthorizationUrl(user.id);
  }

  @Post('youtube/sync')
  @ApiOperation({ summary: 'Refresh YouTube channel metrics now' })
  @ApiOkResponse({ type: SocialConnectionDto })
  syncYouTube(@CurrentUser() user: AuthUser): Promise<SocialConnectionDto> {
    return this.youtube.sync(user.id);
  }

  @Delete('youtube')
  @ApiOperation({ summary: 'Disconnect and revoke YouTube access' })
  @ApiOkResponse({ type: SocialMessageDto })
  disconnectYouTube(
    @CurrentUser() user: AuthUser,
  ): Promise<SocialMessageDto> {
    return this.youtube.disconnect(user.id);
  }
}

@ApiTags('creator social OAuth callbacks')
@Controller('creators/social')
export class SocialOAuthCallbackController {
  private readonly logger = new Logger(SocialOAuthCallbackController.name);

  constructor(private readonly youtube: YouTubeService) {}

  @Get('youtube/callback')
  @ApiOperation({
    summary: 'Google OAuth callback',
    description:
      'Google calls this endpoint. It redirects the browser to the configured frontend URL.',
  })
  async youtubeCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    if (error || !code || !state) {
      response.redirect(
        this.youtube.callbackErrorUrl(error ?? 'authorization_cancelled'),
      );
      return;
    }

    try {
      response.redirect(await this.youtube.handleCallback(code, state));
    } catch (callbackError) {
      this.logger.error('YouTube OAuth callback failed', callbackError);
      response.redirect(this.youtube.callbackErrorUrl('connection_failed'));
    }
  }
}
