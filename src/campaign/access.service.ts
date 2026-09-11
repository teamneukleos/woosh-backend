import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { canAccessOwnedWork } from '../common/work-policy';
import { WorkspaceService } from '../organisation/workspace.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CampaignAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
  ) {}

  async requireCampaignAccess(campaignId: string, userId: string) {
    const actor = await this.workspace.getWorkActor(userId);
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        participants: {
          where: actor.creatorProfileId
            ? { creatorProfileId: actor.creatorProfileId }
            : undefined,
          select: { id: true, creatorProfileId: true, termsAcceptedAt: true },
        },
      },
    });
    if (!campaign) throw new NotFoundException('Campaign not found.');
    const participant = actor.creatorProfileId
      ? campaign.participants.find((row) => row.creatorProfileId === actor.creatorProfileId)
      : undefined;
    const side = participant
      ? 'creator'
      : actor.isPlatformAdmin || actor.brandIds.includes(campaign.brandId)
        ? 'brand'
        : null;
    if (!side) throw new ForbiddenException('You cannot access this campaign.');
    return { actor, campaign, participant, side };
  }

  async requireDeliverableAccess(deliverableId: string, userId: string) {
    const actor = await this.workspace.getWorkActor(userId);
    const deliverable = await this.prisma.deliverable.findUnique({
      where: { id: deliverableId },
      include: {
        participant: { include: { creator: true } },
        campaign: { include: { brand: true } },
        submissions: { orderBy: { version: 'desc' as const } },
      },
    });
    if (!deliverable) throw new NotFoundException('Deliverable not found.');
    const allowed = canAccessOwnedWork({
      isPlatformAdmin: actor.isPlatformAdmin,
      actorCreatorProfileId: actor.creatorProfileId,
      actorBrandIds: actor.brandIds,
      ownerCreatorProfileId: deliverable.participant.creatorProfileId,
      ownerBrandId: deliverable.campaign.brandId,
    });
    const side = !allowed
      ? null
      : actor.creatorProfileId === deliverable.participant.creatorProfileId
        ? 'creator'
        : 'brand';
    if (!side) throw new ForbiddenException('You cannot access this deliverable.');
    return { actor, deliverable, side };
  }

  async requireConversationAccess(conversationId: string, userId: string) {
    const actor = await this.workspace.getWorkActor(userId);
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        application: {
          select: { creatorProfileId: true, brief: { select: { brandId: true } } },
        },
        campaign: {
          select: {
            brandId: true,
            participants: { select: { creatorProfileId: true } },
          },
        },
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found.');
    const creatorAllowed =
      Boolean(actor.creatorProfileId) &&
      (conversation.creatorProfileId === actor.creatorProfileId ||
        conversation.application?.creatorProfileId === actor.creatorProfileId ||
        conversation.campaign?.participants.some(
          (row) => row.creatorProfileId === actor.creatorProfileId,
        ));
    const brandId =
      conversation.brandId ??
      conversation.application?.brief.brandId ??
      conversation.campaign?.brandId;
    if (
      !actor.isPlatformAdmin &&
      !creatorAllowed &&
      (!brandId || !actor.brandIds.includes(brandId))
    ) {
      throw new ForbiddenException('You cannot access this conversation.');
    }
    return conversation;
  }
}
