import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentWorkspace } from './decorators/current-workspace.decorator';
import { RequireOrg, RequirePermission } from './decorators/require-permission.decorator';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { InviteTeammateDto } from './dto/invite-teammate.dto';
import { WorkspaceGuard } from './guards/workspace.guard';
import { OrganisationService } from './organisation.service';
import type { WorkspaceSnapshot } from './workspace.types';

@ApiTags('team')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, WorkspaceGuard)
@Controller('team')
export class TeamController {
  constructor(private readonly organisation: OrganisationService) {}

  @Get()
  @RequireOrg()
  @ApiOperation({ summary: 'Organisation members and pending invites' })
  list(@CurrentWorkspace() ctx: WorkspaceSnapshot) {
    return this.organisation.listTeam(ctx);
  }

  @Post('invites')
  @RequirePermission('team.manage')
  @ApiOperation({
    summary: 'Invite a teammate',
    description:
      'Existing accounts are added immediately and emailed. New emails get a Resend invite (or a console link when RESEND_API_KEY is empty). Cannot invite as OWNER.',
  })
  invite(
    @CurrentWorkspace() ctx: WorkspaceSnapshot,
    @Body() body: InviteTeammateDto,
  ) {
    return this.organisation.inviteTeammate(ctx, body);
  }

  @Post('invites/accept')
  @ApiOperation({
    summary: 'Accept a team invite',
    description: 'Signed-in user email must match the invite.',
  })
  accept(@CurrentUser() user: { id: string }, @Body() body: AcceptInviteDto) {
    return this.organisation.acceptInvite(user.id, body.token);
  }
}
