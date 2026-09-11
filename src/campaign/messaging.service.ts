import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignAccessService } from './access.service';

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CampaignAccessService,
  ) {}

  async list(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        creatorProfile: true,
        memberships: {
          include: { organisation: { include: { brands: true } } },
        },
        brandMemberships: true,
      },
    });
    if (!user) return [];

    const brandIds = new Set<string>();
    for (const membership of user.memberships) {
      for (const brand of membership.organisation.brands) brandIds.add(brand.id);
    }
    for (const membership of user.brandMemberships) brandIds.add(membership.brandId);

    const orFilters: object[] = [];
    if (user.creatorProfile) {
      orFilters.push({ application: { creatorProfileId: user.creatorProfile.id } });
      orFilters.push({
        campaign: {
          participants: { some: { creatorProfileId: user.creatorProfile.id } },
        },
      });
      orFilters.push({ creatorProfileId: user.creatorProfile.id });
    }
    if (brandIds.size) {
      orFilters.push({ application: { brief: { brandId: { in: [...brandIds] } } } });
      orFilters.push({ campaign: { brandId: { in: [...brandIds] } } });
      orFilters.push({ brandId: { in: [...brandIds] } });
    }

    const conversations = await this.prisma.conversation.findMany({
      where: { OR: orFilters.length ? orFilters : [{ id: 'none' }] },
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        application: {
          include: {
            brief: { include: { brand: { select: { name: true } } } },
            creator: { select: { displayName: true } },
          },
        },
        campaign: {
          include: {
            brand: { select: { name: true } },
            participants: {
              include: { creator: { select: { displayName: true } } },
              take: 1,
            },
          },
        },
        brand: { select: { name: true } },
        creator: { select: { displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });

    return conversations
      .sort((a, b) => {
        const aAt = a.messages[0]?.createdAt.getTime() ?? a.createdAt.getTime();
        const bAt = b.messages[0]?.createdAt.getTime() ?? b.createdAt.getTime();
        return bAt - aAt;
      })
      .map((conversation) => ({
        id: conversation.id,
        type: conversation.type,
        title: this.title(conversation),
        lastMessage: conversation.messages[0]
          ? {
              body: conversation.messages[0].body,
              createdAt: conversation.messages[0].createdAt,
              isSystem: conversation.messages[0].isSystem,
            }
          : null,
      }));
  }

  async get(userId: string, conversationId: string) {
    await this.access.requireConversationAccess(conversationId, userId);
    await this.prisma.message.updateMany({
      where: {
        conversationId,
        isSystem: false,
        senderUserId: { not: userId },
        readAt: null,
      },
      data: { readAt: new Date() },
    });
    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        application: {
          include: {
            brief: { include: { brand: { select: { name: true } } } },
            creator: { select: { displayName: true } },
          },
        },
        campaign: {
          include: {
            brand: { select: { name: true } },
            participants: {
              include: { creator: { select: { displayName: true } } },
              take: 1,
            },
          },
        },
        brand: { select: { name: true } },
        creator: { select: { displayName: true } },
      },
    });
    return {
      id: conversation.id,
      type: conversation.type,
      title: this.title(conversation),
      messages: conversation.messages.map((message) => ({
        id: message.id,
        body: message.body,
        isSystem: message.isSystem,
        senderUserId: message.senderUserId,
        createdAt: message.createdAt,
        readAt: message.readAt,
      })),
    };
  }

  async send(userId: string, conversationId: string, bodyRaw: string) {
    await this.access.requireConversationAccess(conversationId, userId);
    const body = bodyRaw.trim();
    if (!body || body.length > 5000) {
      throw new BadRequestException('Message must be between 1 and 5,000 characters.');
    }
    const message = await this.prisma.message.create({
      data: { conversationId, senderUserId: userId, body },
    });

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        application: {
          include: {
            creator: true,
            brief: { include: { brand: { include: { memberships: true } } } },
          },
        },
        campaign: {
          include: {
            brand: { include: { memberships: true } },
            participants: { include: { creator: true } },
          },
        },
      },
    });

    const recipientIds = new Set<string>();
    if (conversation?.application) {
      recipientIds.add(conversation.application.creator.userId);
      for (const member of conversation.application.brief.brand.memberships) {
        recipientIds.add(member.userId);
      }
    }
    if (conversation?.campaign) {
      for (const member of conversation.campaign.brand.memberships) {
        recipientIds.add(member.userId);
      }
      for (const participant of conversation.campaign.participants) {
        recipientIds.add(participant.creator.userId);
      }
    }
    recipientIds.delete(userId);
    for (const recipientId of recipientIds) {
      await this.prisma.notification.create({
        data: {
          userId: recipientId,
          type: 'message.new',
          title: 'New message',
          body: body.slice(0, 120),
          href: `/app/messages?c=${conversationId}`,
          dedupeKey: `message:${message.id}:${recipientId}`,
        },
      });
    }
    await this.prisma.auditEvent.create({
      data: {
        actorId: userId,
        action: 'message.send',
        targetType: 'Message',
        targetId: message.id,
      },
    });
    return {
      id: message.id,
      body: message.body,
      createdAt: message.createdAt,
    };
  }

  private title(conversation: {
    type: string;
    application?: {
      brief: { title: string; brand: { name: string } };
      creator: { displayName: string };
    } | null;
    campaign?: {
      title: string;
      brand: { name: string };
      participants?: Array<{ creator: { displayName: string } }>;
    } | null;
    brand?: { name: string } | null;
    creator?: { displayName: string } | null;
  }) {
    return (
      conversation.application?.brief.title ||
      conversation.campaign?.title ||
      (conversation.brand?.name && conversation.creator?.displayName
        ? `${conversation.brand.name} · ${conversation.creator.displayName}`
        : null) ||
      conversation.brand?.name ||
      conversation.creator?.displayName ||
      'Conversation'
    );
  }
}
