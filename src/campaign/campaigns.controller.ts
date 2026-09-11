import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from '../analytics/analytics.service';
import { LogCampaignMetricDto } from '../analytics/dto/analytics.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CampaignsService } from './campaigns.service';

@ApiTags('campaigns')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('campaigns')
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly analytics: AnalyticsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Campaigns for this seat' })
  list(@CurrentUser() user: { id: string }) {
    return this.campaigns.list(user.id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Campaign workspace: deliverables, submissions, thread',
    description: 'Creators only see their own participant row and deliverables.',
  })
  get(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.campaigns.get(user.id, id);
  }

  @Post(':id/terms')
  @ApiOperation({ summary: 'Creator accepts campaign terms' })
  acceptTerms(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.campaigns.acceptTerms(user.id, id);
  }

  @Post(':id/metrics')
  @ApiOperation({
    summary: 'Log a campaign performance snapshot',
    description:
      'Brand campaigns.manage. Reach, views, and engagement are brand-entered; they are not typed follower counts.',
  })
  logMetric(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: LogCampaignMetricDto,
  ) {
    return this.analytics.logCampaignMetric(user.id, id, body);
  }
}
