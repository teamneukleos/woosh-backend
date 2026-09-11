import { Injectable } from '@nestjs/common';
import { CampaignStatus, DeliverableState, InvitationStatus } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 86_400_000;

function dayKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

@Injectable()
export class WorkRemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async run(now = new Date()) {
    const inThreeDays = new Date(now.getTime() + 3 * DAY_MS);
    const expiringInvitations = await this.prisma.briefInvitation.findMany({
      where: {
        status: { in: [InvitationStatus.SENT, InvitationStatus.VIEWED] },
        brief: { applicationDeadline: { gt: now, lte: inThreeDays } },
      },
      include: { creator: true, brief: { include: { brand: true } } },
    });
    const expiredInvitations = await this.prisma.briefInvitation.findMany({
      where: {
        status: { in: [InvitationStatus.SENT, InvitationStatus.VIEWED] },
        brief: { applicationDeadline: { lte: now } },
      },
      include: { creator: true, brief: { include: { brand: true } } },
    });
    const dueDeliverables = await this.prisma.deliverable.findMany({
      where: {
        dueAt: { lte: inThreeDays },
        state: {
          in: [
            DeliverableState.NOT_STARTED,
            DeliverableState.IN_PROGRESS,
            DeliverableState.REVISION_REQUESTED,
            DeliverableState.APPROVED,
            DeliverableState.SCHEDULED,
          ],
        },
        campaign: { status: CampaignStatus.ACTIVE },
      },
      include: {
        participant: { include: { creator: true } },
        campaign: { include: { brand: true } },
      },
    });

    if (expiredInvitations.length) {
      await this.prisma.briefInvitation.updateMany({
        where: { id: { in: expiredInvitations.map((row) => row.id) } },
        data: { status: InvitationStatus.EXPIRED, respondedAt: now },
      });
    }

    await Promise.all([
      ...expiringInvitations.map((invitation) =>
        this.notifications.create({
          userId: invitation.creator.userId,
          type: 'brief.invitation.expiring',
          title: 'Invitation expires soon',
          body: `${invitation.brief.brand.name} invited you to ${invitation.brief.title}`,
          href: `/app/jobs/${invitation.briefId}`,
          dedupeKey: `invite-expiring:${invitation.id}:${invitation.brief.applicationDeadline?.toISOString()}`,
        }),
      ),
      ...expiredInvitations.map((invitation) =>
        this.notifications.create({
          userId: invitation.creator.userId,
          type: 'brief.invitation.expired',
          title: 'Invitation expired',
          body: `${invitation.brief.title} is no longer accepting applications`,
          href: '/app/work',
          dedupeKey: `invite-expired:${invitation.id}`,
        }),
      ),
      ...dueDeliverables.map((deliverable) => {
        const overdue = !!deliverable.dueAt && deliverable.dueAt < now;
        return this.notifications.create({
          userId: deliverable.participant.creator.userId,
          type: overdue ? 'deliverable.overdue' : 'deliverable.due_soon',
          title: overdue ? 'Deliverable overdue' : 'Deliverable due soon',
          body: `${deliverable.title} for ${deliverable.campaign.brand.name}`,
          href: `/app/campaigns/${deliverable.campaignId}`,
          dedupeKey: overdue
            ? `deliverable-overdue:${deliverable.id}:${dayKey(now)}`
            : `deliverable-due:${deliverable.id}:${deliverable.dueAt?.toISOString()}`,
        });
      }),
    ]);

    return {
      expiringInvitations: expiringInvitations.length,
      expiredInvitations: expiredInvitations.length,
      dueDeliverables: dueDeliverables.length,
    };
  }
}
