import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequirePermission } from '../organisation/decorators/require-permission.decorator';
import { WorkspaceGuard } from '../organisation/guards/workspace.guard';
import { CreateProspectDto } from './dto/create-prospect.dto';
import { DiscoveryQueryDto } from './dto/discovery-query.dto';
import { ExpressInterestDto } from './dto/express-interest.dto';
import { SupplyService } from './supply.service';

@ApiTags('supply')
@ApiBearerAuth('access-token')
@ApiHeader({
  name: 'X-Brand-Id',
  required: false,
  description: 'Active brand for interest, save, and relationship-gated profiles.',
})
@UseGuards(JwtAuthGuard, WorkspaceGuard)
@Controller('creators')
export class SupplyController {
  constructor(private readonly supply: SupplyService) {}

  @Get('discovery')
  @RequirePermission('creators.search')
  @ApiOperation({
    summary: 'Mixed claimed + unclaimed discovery',
    description:
      'Claimed cards only include provider-sourced metrics. Prospect followerEstimate is an ops guess and metricsVerified is always false.',
  })
  discovery(
    @CurrentUser() user: { id: string },
    @Query() query: DiscoveryQueryDto,
    @Headers('x-brand-id') brandId?: string,
  ) {
    return this.supply.listDiscovery(user.id, query, brandId);
  }

  @Post('prospects')
  @RequirePermission('creators.search')
  @ApiOperation({
    summary: 'Add or update an unclaimed handle',
    description: 'Unique per channel + handle. Follower estimate stays labelled unverified.',
  })
  createProspect(
    @CurrentUser() user: { id: string },
    @Body() body: CreateProspectDto,
  ) {
    return this.supply.createProspect(user.id, body);
  }

  @Get('prospects/:id')
  @RequirePermission('creators.search')
  @ApiOperation({ summary: 'Get an unclaimed (or claim-pending) prospect' })
  getProspect(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Headers('x-brand-id') brandId?: string,
  ) {
    return this.supply.getProspect(id, user.id, brandId);
  }

  @Post('interests')
  @RequirePermission('creators.search')
  @ApiOperation({
    summary: 'Express interest / send a claim invite',
    description:
      'Prospects with a contact email get a claim invite via Resend (console fallback without a key). Claimed creators get an in-app thread. Pass brandId or X-Brand-Id.',
  })
  expressInterest(
    @CurrentUser() user: { id: string },
    @Body() body: ExpressInterestDto,
    @Headers('x-brand-id') headerBrandId?: string,
  ) {
    return this.supply.expressInterest(user.id, {
      ...body,
      brandId: body.brandId || headerBrandId,
    });
  }

  @Post(':id/save')
  @RequirePermission('creators.search')
  @ApiOperation({ summary: 'Save a claimed creator to the org roster' })
  save(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Headers('x-brand-id') brandId?: string,
  ) {
    return this.supply.saveCreator(user.id, id, brandId);
  }

  @Delete(':id/save')
  @RequirePermission('creators.search')
  @ApiOperation({ summary: 'Remove a claimed creator from the saved roster' })
  unsave(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.supply.unsaveCreator(user.id, id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Claimed storefront or prospect by id',
    description:
      'Unpublished claimed profiles are hidden unless you own them, are admin, or have a brand relationship.',
  })
  getOne(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Headers('x-brand-id') brandId?: string,
  ) {
    return this.supply.getCreator(id, user.id, brandId);
  }
}
