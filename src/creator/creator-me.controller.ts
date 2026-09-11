import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AnalyticsService } from '../analytics/analytics.service';
import { InsightsQueryDto } from '../analytics/dto/analytics.dto';
import { CreatorGuard } from './creator.guard';
import { CurrentCreatorId } from './current-creator.decorator';
import { ConnectSocialDto } from './dto/connect-social.dto';
import { CreateRatePackageDto } from './dto/create-rate.dto';
import {
  AddCampaignContentDto,
  CreatePortfolioEmbedDto,
  PortfolioMetaDto,
  ReorderPortfolioDto,
  UploadCreatorImageDto,
} from './dto/portfolio.dto';
import { UpdateCreatorProfileDto } from './dto/update-profile.dto';
import { MediaService } from './media.service';
import { CreatorProfileService } from './profile.service';
import { DevOAuthDto } from './dto/oauth.dto';
import { SocialOAuthService } from './social-oauth.service';

function requireFile(file?: Express.Multer.File) {
  if (!file?.buffer?.length) {
    throw new BadRequestException('Choose a file');
  }
  return file;
}

@ApiTags('creator')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, CreatorGuard)
@Controller('creators/me')
export class CreatorMeController {
  constructor(
    private readonly profiles: CreatorProfileService,
    private readonly media: MediaService,
    private readonly oauth: SocialOAuthService,
    private readonly analytics: AnalyticsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Own creator profile, rates, socials, portfolio, and readiness',
    description: 'Follower counts never appear as typed fields. Metrics only exist after a provider snapshot.',
  })
  me(@CurrentCreatorId() creatorProfileId: string) {
    return this.profiles.getMine(creatorProfileId);
  }

  @Get('insights')
  @ApiOperation({
    summary: 'Own channel, opportunity, campaign, and earnings insights',
    description:
      'Follower counts come only from provider snapshots. Window is 7, 30, or 90 days.',
  })
  insights(
    @CurrentCreatorId() creatorProfileId: string,
    @Query() query: InsightsQueryDto,
  ) {
    return this.analytics.creatorInsights(creatorProfileId, query.days);
  }

  @Patch()
  @ApiOperation({ summary: 'Update own creator profile' })
  update(
    @CurrentCreatorId() creatorProfileId: string,
    @CurrentUser() user: { id: string },
    @Body() body: UpdateCreatorProfileDto,
  ) {
    return this.profiles.updateMine(creatorProfileId, user.id, body);
  }

  @Post('submit-review')
  @ApiOperation({
    summary: 'Submit profile for marketplace review',
    description:
      'Requires live connected metrics, a rate package, and three approved portfolio items.',
  })
  submit(
    @CurrentCreatorId() creatorProfileId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.profiles.submitForReview(creatorProfileId, user.id);
  }

  @Post('image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8_000_000 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['kind', 'file'],
      properties: {
        kind: { type: 'string', enum: ['avatar', 'cover'] },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({ summary: 'Upload avatar or cover image' })
  uploadImage(
    @CurrentCreatorId() creatorProfileId: string,
    @CurrentUser() user: { id: string },
    @Body() body: UploadCreatorImageDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.media.uploadImage(creatorProfileId, user.id, body.kind, requireFile(file));
  }

  @Post('portfolio/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100_000_000 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a portfolio image or video' })
  uploadPortfolio(
    @CurrentCreatorId() creatorProfileId: string,
    @CurrentUser() user: { id: string },
    @Body() body: PortfolioMetaDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.media.addUpload(creatorProfileId, user.id, body, requireFile(file));
  }

  @Post('portfolio/embed')
  @ApiOperation({ summary: 'Add an Instagram, TikTok, or YouTube embed' })
  embedPortfolio(
    @CurrentCreatorId() creatorProfileId: string,
    @CurrentUser() user: { id: string },
    @Body() body: CreatePortfolioEmbedDto,
  ) {
    return this.media.addEmbed(creatorProfileId, user.id, body);
  }

  @Post('portfolio/from-submission')
  @ApiOperation({ summary: 'Add approved campaign content to the portfolio' })
  fromSubmission(
    @CurrentCreatorId() creatorProfileId: string,
    @CurrentUser() user: { id: string },
    @Body() body: AddCampaignContentDto,
  ) {
    return this.media.addCampaignContent(creatorProfileId, user.id, body);
  }

  @Post('portfolio/reorder')
  @ApiOperation({ summary: 'Reorder portfolio items' })
  reorder(
    @CurrentCreatorId() creatorProfileId: string,
    @CurrentUser() user: { id: string },
    @Body() body: ReorderPortfolioDto,
  ) {
    return this.media.reorder(creatorProfileId, user.id, body);
  }

  @Patch('portfolio/:id')
  @ApiOperation({ summary: 'Update portfolio item metadata' })
  updatePortfolio(
    @CurrentCreatorId() creatorProfileId: string,
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: PortfolioMetaDto,
  ) {
    return this.media.updateItem(creatorProfileId, user.id, id, body);
  }

  @Delete('portfolio/:id')
  @ApiOperation({ summary: 'Delete a portfolio item' })
  deletePortfolio(
    @CurrentCreatorId() creatorProfileId: string,
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.media.deleteItem(creatorProfileId, user.id, id);
  }

  @Post('rates')
  @ApiOperation({ summary: 'Add a rate package' })
  createRate(
    @CurrentCreatorId() creatorProfileId: string,
    @CurrentUser() user: { id: string },
    @Body() body: CreateRatePackageDto,
  ) {
    return this.profiles.createRate(creatorProfileId, user.id, body);
  }

  @Delete('rates/:id')
  @ApiOperation({ summary: 'Remove a rate package' })
  deleteRate(
    @CurrentCreatorId() creatorProfileId: string,
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.profiles.deleteRate(creatorProfileId, user.id, id);
  }

  @Post('socials/oauth/authorize')
  @ApiOperation({
    summary: 'Start Instagram, TikTok, or YouTube OAuth',
    description:
      'Reserves the channel as PENDING and returns a provider authorize URL when Nest has credentials. Instagram uses Composio (Business/Creator + Facebook Page). YouTube uses Google OAuth. Metrics are never typed.',
  })
  authorizeOAuth(
    @CurrentCreatorId() creatorProfileId: string,
    @CurrentUser() user: { id: string },
    @Body() body: ConnectSocialDto,
  ) {
    return this.oauth.authorize(creatorProfileId, user.id, body.channel);
  }

  @Post('socials/dev')
  @ApiOperation({
    summary: 'Local demo social connection',
    description: 'Requires WOOSH_ALLOW_DEV_OAUTH=true and never runs in production.',
  })
  devOAuth(
    @CurrentCreatorId() creatorProfileId: string,
    @CurrentUser() user: { id: string },
    @Body() body: DevOAuthDto,
  ) {
    return this.oauth.completeDev(creatorProfileId, user.id, body);
  }

  @Post('socials/:id/refresh')
  @ApiOperation({ summary: 'Refresh provider metrics for one connected account' })
  refreshSocial(
    @CurrentCreatorId() creatorProfileId: string,
    @Param('id') id: string,
  ) {
    return this.oauth.refresh(creatorProfileId, id);
  }

  @Post('socials')
  @ApiOperation({
    summary: 'Reserve a social handle as PENDING',
    description:
      'Does not accept follower counts. The account stays PENDING until OAuth verifies it.',
  })
  connectSocial(
    @CurrentCreatorId() creatorProfileId: string,
    @CurrentUser() user: { id: string },
    @Body() body: ConnectSocialDto,
  ) {
    return this.profiles.connectSocial(creatorProfileId, user.id, body);
  }
}
