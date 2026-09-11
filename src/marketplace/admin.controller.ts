import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { MediaService } from '../creator/media.service';
import { WorkspaceService } from '../organisation/workspace.service';
import { AdminOpsService } from './admin.service';
import { BriefsService } from './briefs.service';
import {
  SeedProspectsDto,
  SetAdminDto,
  VerifyOrganisationDto,
} from './dto/admin-ops.dto';
import { ModerationDecisionDto } from './dto/moderation.dto';
import { SelectionService } from './selection.service';

@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly briefs: BriefsService,
    private readonly selection: SelectionService,
    private readonly media: MediaService,
    private readonly workspace: WorkspaceService,
    private readonly ops: AdminOpsService,
  ) {}

  @Post('bootstrap')
  @ApiOperation({
    summary: 'Promote the current user to platform admin (local only)',
    description: 'Works once, only when no admin exists, and never in production.',
  })
  bootstrap(@CurrentUser() user: { id: string }) {
    return this.selection.bootstrapAdmin(user.id);
  }

  @Get('creators/moderation')
  @ApiOperation({ summary: 'Pending creator profiles and portfolio media' })
  creatorModeration(@CurrentUser() user: { id: string }) {
    return this.selection.listCreatorModeration(user.id);
  }

  @Post('briefs/:id/review')
  @ApiOperation({ summary: 'Approve or reject a brief in moderation' })
  reviewBrief(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: ModerationDecisionDto,
  ) {
    return this.briefs.moderate(user.id, id, body.approve, body.reason);
  }

  @Post('creators/:id/review')
  @ApiOperation({
    summary: 'Approve or reject a creator profile',
    description: 'Approve sets marketplaceStatus PUBLISHED so they can apply to briefs.',
  })
  reviewCreator(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: ModerationDecisionDto,
  ) {
    return this.selection.moderateCreator(user.id, id, body.approve, body.reason);
  }

  @Post('creators/media/:id/review')
  @ApiOperation({ summary: 'Approve or reject a portfolio item' })
  async reviewMedia(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: ModerationDecisionDto,
  ) {
    await this.workspace.requirePlatformAdmin(user.id);
    return this.media.moderate(user.id, id, body.approve, body.reason);
  }

  @Get('briefs/moderation')
  @ApiOperation({ summary: 'Briefs waiting on platform review' })
  pendingBriefs(@CurrentUser() user: { id: string }) {
    return this.ops.listPendingBriefs(user.id);
  }

  @Get('organisations')
  @ApiOperation({ summary: 'Organisations for verification' })
  organisations(@CurrentUser() user: { id: string }) {
    return this.ops.listOrganisations(user.id);
  }

  @Post('organisations/:id/verify')
  @ApiOperation({ summary: 'Verify or unverify an organisation' })
  verifyOrganisation(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: VerifyOrganisationDto,
  ) {
    return this.ops.verifyOrganisation(user.id, id, body.verified);
  }

  @Get('users')
  @ApiOperation({ summary: 'Users and platform-admin flags' })
  users(@CurrentUser() user: { id: string }) {
    return this.ops.listUsers(user.id);
  }

  @Post('users/:id/admin')
  @ApiOperation({
    summary: 'Grant or revoke platform admin',
    description: 'The last remaining platform admin cannot be revoked.',
  })
  setAdmin(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: SetAdminDto,
  ) {
    return this.ops.setUserAdmin(user.id, id, body.isAdmin);
  }

  @Get('prospects')
  @ApiOperation({ summary: 'Unclaimed prospect directory count' })
  prospects(@CurrentUser() user: { id: string }) {
    return this.ops.prospectCount(user.id);
  }

  @Post('prospects/seed')
  @ApiOperation({
    summary: 'Bulk upsert unclaimed handles',
    description:
      'Follower estimates stay unverified ops guesses. Never copied onto a claimed profile.',
  })
  seedProspects(
    @CurrentUser() user: { id: string },
    @Body() body: SeedProspectsDto,
  ) {
    return this.ops.seedProspects(user.id, body.rows);
  }
}
