import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreatorGuard } from '../creator/creator.guard';
import { CurrentCreatorId } from '../creator/current-creator.decorator';
import { BriefsService } from './briefs.service';
import { ApplyBriefDto } from './dto/apply-brief.dto';
import { WithdrawApplicationDto } from './dto/withdraw.dto';
import { SelectionService } from './selection.service';

@ApiTags('jobs')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, CreatorGuard)
@Controller('jobs')
export class JobsController {
  constructor(
    private readonly briefs: BriefsService,
    private readonly selection: SelectionService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Open jobs ranked for this creator',
    description: 'tab=applied | invited. Default is open/hybrid briefs ranked by fit.',
  })
  list(
    @CurrentCreatorId() creatorProfileId: string,
    @Query('tab') tab?: string,
  ) {
    return this.briefs.listJobs(creatorProfileId, tab);
  }

  @Post('invites/:invitationId/decline')
  @ApiOperation({ summary: 'Decline a brief invitation' })
  declineInvite(
    @CurrentCreatorId() creatorProfileId: string,
    @Param('invitationId') invitationId: string,
    @Body() body: WithdrawApplicationDto = {},
  ) {
    return this.briefs.declineInvitation(
      creatorProfileId,
      invitationId,
      body.reason,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'View a job and mark an invite as viewed' })
  async get(
    @CurrentUser() user: { id: string },
    @CurrentCreatorId() creatorProfileId: string,
    @Param('id') id: string,
  ) {
    await this.briefs.markInvitationViewed(creatorProfileId, id);
    return this.briefs.get(user.id, id);
  }

  @Post(':id/apply')
  @ApiOperation({
    summary: 'Apply to a brief',
    description: 'Creator profile must be PUBLISHED. Invite-only briefs require an invitation.',
  })
  apply(
    @CurrentUser() user: { id: string },
    @CurrentCreatorId() creatorProfileId: string,
    @Param('id') id: string,
    @Body() body: ApplyBriefDto,
  ) {
    return this.selection.apply(user.id, creatorProfileId, id, body);
  }
}
