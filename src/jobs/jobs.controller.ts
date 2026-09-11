import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CronGuard } from '../common/guards/cron.guard';
import { SocialOAuthService } from '../creator/social-oauth.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PayoutService } from '../payments/payout.service';
import { WorkRemindersService } from './work-reminders.service';

@ApiTags('internal')
@ApiSecurity('cron')
@UseGuards(CronGuard)
@Controller('internal')
export class JobsController {
  constructor(
    private readonly oauth: SocialOAuthService,
    private readonly payouts: PayoutService,
    private readonly notifications: NotificationsService,
    private readonly reminders: WorkRemindersService,
  ) {}

  @Post('social-metrics')
  @ApiOperation({
    summary: 'Refresh stale ACTIVE social metrics',
    description: 'Bearer WOOSH_CRON_SECRET. Accounts not synced in 24 hours.',
  })
  socialMetrics() {
    return this.oauth.refreshDue();
  }

  @Post('work-reminders')
  @ApiOperation({
    summary: 'Expire invitations and remind creators about due work',
  })
  workReminders() {
    return this.reminders.run();
  }

  @Post('weekly-digests')
  @ApiOperation({
    summary: 'Email last week’s in-app notifications to opted-in users',
  })
  weeklyDigests() {
    return this.notifications.sendWeeklyDigests();
  }

  @Post('payment-releases')
  @ApiOperation({
    summary: 'Release due payouts and reconcile stale PROCESSING transfers',
    description: 'Same work as POST /admin/payouts/process-due, for the scheduler.',
  })
  async paymentReleases() {
    const released = await this.payouts.processAutomaticReleases();
    const reconciled = await this.payouts.reconcileProcessing();
    return { release: released, reconcile: reconciled };
  }
}
