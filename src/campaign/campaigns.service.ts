import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { asNumber } from '../common/fees';
import { WorkspaceService } from '../organisation/workspace.service';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignAccessService } from './access.service';

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
    private readonly access: CampaignAccessService,
  ) {}

  async list(userId: string) {
    const actor = await this.workspace.getWorkActor(userId);
    if (actor.creatorProfileId) {
      const campaigns = await this.prisma.campaign.findMany({
        where: {
          participants: { some: { creatorProfileId: actor.creatorProfileId } },
        },
        include: {
          brand: { select: { id: true, name: true } },
          deliverables: {
            where: { participant: { creatorProfileId: actor.creatorProfileId } },
          },
          participants: { where: { creatorProfileId: actor.creatorProfileId } },
        },
        orderBy: { updatedAt: 'desc' },
      });
      return campaigns.map((campaign) => this.presentList(campaign));
    }

    const campaigns = await this.prisma.campaign.findMany({
      where: { brandId: { in: actor.brandIds } },
      include: {
        brand: { select: { id: true, name: true } },
        deliverables: true,
        participants: {
          include: { creator: { select: { id: true, displayName: true } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return campaigns.map((campaign) => this.presentList(campaign));
  }

  async get(userId: string, campaignId: string) {
    const { side, participant } = await this.access.requireCampaignAccess(
      campaignId,
      userId,
    );
    const campaign = await this.prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      include: {
        brand: { select: { id: true, name: true } },
        brief: { select: { id: true, title: true } },
        deliverables: {
          where:
            side === 'creator' && participant
              ? { campaignParticipantId: participant.id }
              : undefined,
          include: {
            participant: {
              include: { creator: { select: { id: true, displayName: true, userId: true } } },
            },
            submissions: { orderBy: { version: 'desc' } },
          },
        },
        participants: {
          where: side === 'creator' && participant ? { id: participant.id } : undefined,
          include: { creator: { select: { id: true, displayName: true } } },
        },
        conversations: {
          include: { messages: { orderBy: { createdAt: 'asc' } } },
        },
      },
    });
    return {
      id: campaign.id,
      title: campaign.title,
      status: campaign.status,
      brand: campaign.brand,
      brief: campaign.brief,
      side,
      participants: campaign.participants.map((row) => ({
        id: row.id,
        creatorProfileId: row.creatorProfileId,
        displayName: row.creator.displayName,
        agreedRate: asNumber(row.agreedRate),
        currency: row.currency,
        status: row.status,
        termsAcceptedAt: row.termsAcceptedAt,
      })),
      deliverables: campaign.deliverables.map((row) => ({
        id: row.id,
        title: row.title,
        channel: row.channel,
        state: row.state,
        dueAt: row.dueAt,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        creator: row.participant.creator.displayName,
        submissions: row.submissions.map((submission) => ({
          id: submission.id,
          version: submission.version,
          draftUrl: submission.draftUrl,
          liveUrl: submission.liveUrl,
          notes: submission.notes,
          reviewNotes: submission.reviewNotes,
          submittedAt: submission.submittedAt,
          reviewedAt: submission.reviewedAt,
        })),
      })),
      conversations: campaign.conversations.map((conversation) => ({
        id: conversation.id,
        type: conversation.type,
        messages: conversation.messages.map((message) => ({
          id: message.id,
          body: message.body,
          isSystem: message.isSystem,
          senderUserId: message.senderUserId,
          createdAt: message.createdAt,
        })),
      })),
    };
  }

  async acceptTerms(userId: string, campaignId: string) {
    const { side, participant } = await this.access.requireCampaignAccess(
      campaignId,
      userId,
    );
    if (side !== 'creator' || !participant) {
      throw new ForbiddenException('Creator access required.');
    }
    if (participant.termsAcceptedAt) {
      return { ok: true, termsAcceptedAt: participant.termsAcceptedAt };
    }
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { status: true },
    });
    if (campaign?.status !== 'ACTIVE') {
      throw new NotFoundException('Campaign participation not found.');
    }
    const updated = await this.prisma.campaignParticipant.update({
      where: { id: participant.id },
      data: { termsAcceptedAt: new Date() },
    });
    await this.prisma.auditEvent.create({
      data: {
        actorId: userId,
        action: 'campaign.terms.accept',
        targetType: 'CampaignParticipant',
        targetId: updated.id,
      },
    });
    return { ok: true, termsAcceptedAt: updated.termsAcceptedAt };
  }

  private presentList(campaign: {
    id: string;
    title: string;
    status: string;
    brand: { id: string; name: string };
    deliverables: Array<{ id: string; state: string }>;
    participants: Array<{
      id: string;
      termsAcceptedAt: Date | null;
      creator?: { displayName: string };
    }>;
  }) {
    return {
      id: campaign.id,
      title: campaign.title,
      status: campaign.status,
      brand: campaign.brand,
      deliverableCount: campaign.deliverables.length,
      states: campaign.deliverables.map((row) => row.state),
      participants: campaign.participants.map((row) => ({
        id: row.id,
        termsAcceptedAt: row.termsAcceptedAt,
        displayName: row.creator?.displayName,
      })),
    };
  }
}
