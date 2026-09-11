import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WorkspaceService } from '../organisation/workspace.service';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { DisputesService } from './disputes.service';
import { PayoutService } from './payout.service';
import { WebhooksService } from './webhooks.service';

@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('admin')
export class AdminPaymentsController {
  constructor(
    private readonly payouts: PayoutService,
    private readonly disputes: DisputesService,
    private readonly webhooks: WebhooksService,
    private readonly workspace: WorkspaceService,
  ) {}

  @Post('payouts/process-due')
  @ApiOperation({
    summary: 'Process obligations whose 72-hour window has closed',
    description: 'Platform admin. Queues Paystack transfers or marks PAID in test mode. Also reconciles stale PROCESSING rows.',
  })
  async processDue(@CurrentUser() user: { id: string }) {
    await this.workspace.requirePlatformAdmin(user.id);
    const released = await this.payouts.processAutomaticReleases();
    const reconciled = await this.payouts.reconcileProcessing();
    return { ...released, ...reconciled };
  }

  @Post('payouts/:id/open-window')
  @ApiOperation({
    summary: 'Set availableAt to now (local only)',
    description: 'Skips the 72-hour wait so Swagger can exercise payouts. Never works in production.',
  })
  openWindow(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.payouts.openReleaseWindow(id, user.id);
  }

  @Post('disputes/:id/resolve')
  @ApiOperation({
    summary: 'Resolve a payment dispute',
    description:
      'RELEASE_PAYOUT returns the obligation to APPROVED with availableAt now. REFUND_BRAND credits that brand’s wallet only — never another client.',
  })
  resolve(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: ResolveDisputeDto,
  ) {
    return this.disputes.resolve({
      disputeId: id,
      actorUserId: user.id,
      resolutionType: body.resolutionType,
      resolution: body.resolution,
    });
  }

  @Get('webhooks/failed')
  @ApiOperation({ summary: 'Failed Paystack webhook events' })
  failedWebhooks(@CurrentUser() user: { id: string }) {
    return this.webhooks.listFailed(user.id);
  }

  @Post('webhooks/:id/replay')
  @ApiOperation({ summary: 'Replay a failed Paystack webhook' })
  replay(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.webhooks.replay(id, user.id);
  }
}
