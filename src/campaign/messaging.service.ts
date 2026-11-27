import { BadRequestException, Injectable } from '@nestjs/common';
import { hasOrgWideBrandAccess } from '../common/permissions';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignAccessService } from './access.service';
import { MessagingGateway } from './messaging.gateway';

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CampaignAccessService,
    private readonly realtime: MessagingGateway,
    private readonly notifications: NotificationsService,
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
      if (!hasOrgWideBrandAccess(membership.role)) continue;
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

    const conversationIds = conversations.map((conversation) => conversation.id);

    const unreadGroups = conversationIds.length
      ? await this.prisma.message.groupBy({
          by: ['conversationId'],
         where: {
            conversationId: { in: conversationIds },
            isSystem: false,
            readAt: null,
            AND: [
              { senderUserId: { not: null } },
              { senderUserId: { not: userId } },
            ],
          },
          _count: { _all: true },
        })
      : [];

    const unreadCountByConversation = new Map(
      unreadGroups.map((group) => [
        group.conversationId,
        group._count._all,
      ]),
    );

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
        unreadCount: unreadCountByConversation.get(conversation.id) ?? 0,
        lastMessage: conversation.messages[0]
        ? {
            body: conversation.messages[0].body,
            createdAt: conversation.messages[0].createdAt,
            isSystem: conversation.messages[0].isSystem,
            senderUserId: conversation.messages[0].senderUserId,
            readAt: conversation.messages[0].readAt,
          }
        : null,
      }));
  }

  async unreadCount(userId: string) {
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

  if (!user) return 0;

  const brandIds = new Set<string>();

  for (const membership of user.memberships) {
    if (!hasOrgWideBrandAccess(membership.role)) continue;

    for (const brand of membership.organisation.brands) {
      brandIds.add(brand.id);
    }
  }

  for (const membership of user.brandMemberships) {
    brandIds.add(membership.brandId);
  }

  const orFilters: object[] = [];

  if (user.creatorProfile) {
    orFilters.push({
      application: { creatorProfileId: user.creatorProfile.id },
    });
    orFilters.push({
      campaign: {
        participants: {
          some: { creatorProfileId: user.creatorProfile.id },
        },
      },
    });
    orFilters.push({
      creatorProfileId: user.creatorProfile.id,
    });
  }

  if (brandIds.size) {
    orFilters.push({
      application: { brief: { brandId: { in: [...brandIds] } } },
    });
    orFilters.push({
      campaign: { brandId: { in: [...brandIds] } },
    });
    orFilters.push({
      brandId: { in: [...brandIds] },
    });
  }

  const conversations = await this.prisma.conversation.findMany({
    where: { OR: orFilters.length ? orFilters : [{ id: 'none' }] },
    select: { id: true },
  });

  if (!conversations.length) return 0;

  return this.prisma.message.count({
    where: {
      conversationId: {
        in: conversations.map((conversation) => conversation.id),
      },
      isSystem: false,
      readAt: null,
      AND: [
        { senderUserId: { not: null } },
        { senderUserId: { not: userId } },
      ],
    },
  });
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
    // Reading the thread clears its "new message" notification, so the next one can email.
    await this.prisma.notification.updateMany({
      where: {
        userId,
        type: 'message.received',
        href: `/app/messages?c=${conversationId}`,
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
            creator: { select: { displayName: true, userId: true } },
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
    // Message.offerId has no Prisma relation, so load linked offers in one extra query
    // (only when the thread has any).
    const offerIds = [
      ...new Set(
        conversation.messages
          .map((message) => message.offerId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const offers = offerIds.length
      ? await this.prisma.offer.findMany({
          where: { id: { in: offerIds } },
          select: {
            id: true,
            status: true,
            createdById: true,
            amount: true,
            currency: true,
          },
        })
      : [];
    const offerById = new Map(offers.map((offer) => [offer.id, offer]));
    const creatorUserId = conversation.application?.creator.userId;
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
        // Display data only; agreeing still goes through POST /offers/:id/agree.
        offer: this.offerView(
          message.offerId ? offerById.get(message.offerId) : undefined,
          creatorUserId,
        ),
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

    await this.prisma.auditEvent.create({
      data: {
        actorId: userId,
        action: 'message.send',
        targetType: 'Message',
        targetId: message.id,
      },
    });
        this.realtime.emitMessage(
      {
        conversationId,
        message: {
          id: message.id,
          body: message.body ?? '',
          isSystem: false,
          senderUserId: message.senderUserId ?? userId,
          createdAt: message.createdAt,
          readAt: message.readAt,
        },
      },
      Array.from(recipientIds),
    );
    // After the realtime emit, so email latency never delays live chat delivery.
    if (conversation && recipientIds.size) {
      const senderCreator =
        conversation.application?.creator.userId === userId
          ? conversation.application.creator
          : conversation.campaign?.participants.find((row) => row.creator.userId === userId)
              ?.creator;
      const brandName =
        conversation.application?.brief.brand.name ?? conversation.campaign?.brand.name;
      await this.notifications.notifyNewMessage({
        messageId: message.id,
        conversationId,
        recipientIds,
        senderName: senderCreator?.displayName ?? brandName ?? 'your Woosh contact',
        contextTitle: this.title(conversation),
      });
    }

    return {
      id: message.id,
      body: message.body,
      senderUserId: message.senderUserId,
      createdAt: message.createdAt,
    };
  }

  private offerView(
    offer:
      | {
          id: string;
          status: string;
          createdById: string;
          amount: unknown;
          currency: string;
        }
      | undefined,
    creatorUserId: string | undefined,
  ) {
    if (!offer) return null;
    return {
      id: offer.id,
      status: offer.status,
      createdById: offer.createdById,
      createdBySide: !creatorUserId
        ? null
        : offer.createdById === creatorUserId
          ? ('creator' as const)
          : ('brand' as const),
      amount: Number(offer.amount),
      currency: offer.currency,
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