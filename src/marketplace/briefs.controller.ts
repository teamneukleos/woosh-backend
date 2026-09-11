import {
  Body,
  Controller,
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
import { RequireOrg, RequirePermission } from '../organisation/decorators/require-permission.decorator';
import { WorkspaceGuard } from '../organisation/guards/workspace.guard';
import { BriefsService } from './briefs.service';
import { CreateBriefDto } from './dto/create-brief.dto';
import { InviteToBriefDto } from './dto/invite-brief.dto';

@ApiTags('briefs')
@ApiBearerAuth('access-token')
@ApiHeader({ name: 'X-Brand-Id', required: false })
@UseGuards(JwtAuthGuard, WorkspaceGuard)
@Controller('briefs')
export class BriefsController {
  constructor(private readonly briefs: BriefsService) {}

  @Get()
  @RequireOrg()
  @ApiOperation({ summary: 'List briefs for the active brand' })
  list(
    @CurrentUser() user: { id: string },
    @Query('brandId') brandId?: string,
    @Headers('x-brand-id') headerBrandId?: string,
  ) {
    return this.briefs.listForBrand(user.id, headerBrandId || brandId);
  }

  @Post()
  @RequirePermission('briefs.manage')
  @ApiOperation({
    summary: 'Create a draft brief',
    description: 'RANGE_NEGOTIABLE needs rateMin and rateMax. Other modes need a positive rateAmount.',
  })
  create(
    @CurrentUser() user: { id: string },
    @Body() body: CreateBriefDto,
    @Headers('x-brand-id') headerBrandId?: string,
  ) {
    return this.briefs.create(user.id, body, headerBrandId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a brief (brand roster or invited/open creator)' })
  get(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.briefs.get(user.id, id);
  }

  @Post(':id/publish')
  @RequirePermission('briefs.manage')
  @ApiOperation({
    summary: 'Publish a draft brief',
    description:
      'First brief, unverified org, or flagged copy goes to PENDING_MODERATION. Established verified orgs auto-open.',
  })
  publish(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.briefs.publish(user.id, id);
  }

  @Post(':id/invites')
  @RequirePermission('briefs.manage')
  @ApiOperation({ summary: 'Invite a claimed creator to this brief' })
  invite(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: InviteToBriefDto,
  ) {
    return this.briefs.invite(user.id, id, body.creatorProfileId, body.message);
  }
}
