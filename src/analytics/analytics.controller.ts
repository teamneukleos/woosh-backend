import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequirePermission } from '../organisation/decorators/require-permission.decorator';
import { WorkspaceGuard } from '../organisation/guards/workspace.guard';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@ApiBearerAuth('access-token')
@ApiHeader({ name: 'X-Brand-Id', required: false })
@UseGuards(JwtAuthGuard, WorkspaceGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('campaigns')
  @RequirePermission('analytics.view')
  @ApiOperation({
    summary: 'Logged campaign metrics for the active brand',
    description:
      'Totals use the latest metric per post. Pass brandId or X-Brand-Id. Never mixes another brand’s wallet or campaigns.',
  })
  listBrandCampaigns(
    @CurrentUser() user: { id: string },
    @Query('brandId') brandId?: string,
    @Headers('x-brand-id') headerBrandId?: string,
  ) {
    const id = headerBrandId || brandId;
    if (!id) {
      throw new BadRequestException(
        'Select a brand first (brandId or X-Brand-Id).',
      );
    }
    return this.analytics.listBrandCampaignMetrics(user.id, id);
  }
}
