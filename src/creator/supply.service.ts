import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProspectStatus, SocialChannel } from '@prisma/client';
import { AnalyticsService } from '../analytics/analytics.service';
import { hashToken, newOpaqueToken } from '../common/crypto/tokens';
import { MailService } from '../mail/mail.service';
import { claimInviteMessage } from '../mail/templates';
import { WorkspaceService } from '../organisation/workspace.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateProspectDto } from './dto/create-prospect.dto';
import type { DiscoveryQueryDto } from './dto/discovery-query.dto';
import type { ExpressInterestDto } from './dto/express-interest.dto';
import { asNumber, normalizeHandle } from './handle';

type DiscoveryItem = {
  id: string;
  type: 'claimed' | 'prospect';
  displayName: string;
  channel?: SocialChannel;
  channels?: SocialChannel[];
  handle?: string;
  avatarUrl?: string | null;
  locationCountry?: string | null;
  locationCity?: string | null;
  categories: string[];
  followerEstimate?: number | null;
  followers?: number | null;
  engagementRate?: number | null;
  averageLikes?: number | null;
  averageViews?: number | null;
  metricsVerified: boolean;
  verified: boolean;
  status?: string;
  startingRate?: number | null;
  rateCurrency?: string;
  saved?: boolean;
  interested?: boolean;
};

@Injectable()
export class SupplyService {
  private readonly logger = new Logger(SupplyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
    private readonly mail: MailService,
    private readonly analytics: AnalyticsService,
  ) {}

  async listDiscovery(
    userId: string,
    filters: DiscoveryQueryDto,
    brandId?: string,
  ): Promise<{
    items: DiscoveryItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const items: DiscoveryItem[] = [];
    const q = filters.q?.trim().toLowerCase();
    const pageSize = Math.min(Math.max(filters.pageSize ?? 100, 1), 2000);
    const requestedPage = Math.max(filters.page ?? 1, 1);

    if (!filters.prospectOnly) {
      items.push(...(await this.listClaimed(filters, q)));
    }
    if (!filters.claimedOnly) {
      items.push(...(await this.listProspects(filters, q)));
    }

    if (filters.sort && filters.sort !== 'newest') {
      items.sort((a, b) => {
        if (filters.sort === 'price') {
          return (
            (a.startingRate ?? Number.MAX_SAFE_INTEGER) -
            (b.startingRate ?? Number.MAX_SAFE_INTEGER)
          );
        }
        const value = (item: DiscoveryItem) => {
          if (filters.sort === 'followers') return item.followers ?? 0;
          if (filters.sort === 'engagement') return item.engagementRate ?? 0;
          return item.averageViews ?? 0;
        };
        return value(b) - value(a);
      });
    }

    let ranked = items;
    if (filters.savedOnly) {
      const flags = await this.loadRelationshipFlags(
        userId,
        brandId,
        items.filter((item) => item.type === 'claimed').map((item) => item.id),
        items.filter((item) => item.type === 'prospect').map((item) => item.id),
      );
      ranked = items
        .map((item) => this.withRelationshipFlags(item, flags))
        .filter((item) => item.saved);
    }

    const total = ranked.length;
    const page = Math.min(
      requestedPage,
      Math.max(1, Math.ceil(total / pageSize) || 1),
    );
    const start = (page - 1) * pageSize;
    const pageItems = ranked.slice(start, start + pageSize);

    if (filters.savedOnly) {
      return { items: pageItems, total, page, pageSize };
    }

    const flags = await this.loadRelationshipFlags(
      userId,
      brandId,
      pageItems.filter((item) => item.type === 'claimed').map((item) => item.id),
      pageItems.filter((item) => item.type === 'prospect').map((item) => item.id),
    );
    return {
      items: pageItems.map((item) => this.withRelationshipFlags(item, flags)),
      total,
      page,
      pageSize,
    };
  }

  private withRelationshipFlags(
    item: DiscoveryItem,
    flags: {
      saved: Set<string>;
      interestedCreators: Set<string>;
      interestedProspects: Set<string>;
    },
  ): DiscoveryItem {
    return {
      ...item,
      saved: flags.saved.has(item.id),
      interested:
        item.type === 'prospect'
          ? flags.interestedProspects.has(item.id)
          : flags.interestedCreators.has(item.id),
    };
  }

  async createProspect(userId: string, input: CreateProspectDto) {
    const handle = normalizeHandle(input.handle);
    const prospect = await this.prisma.creatorProspect.upsert({
      where: { channel_handle: { channel: input.channel, handle } },
      create: {
        channel: input.channel,
        handle,
        displayName: input.displayName,
        locationCountry: input.locationCountry,
        locationCity: input.locationCity,
        categories: input.categories ?? [],
        followerEstimate: input.followerEstimate,
        contactEmail: input.contactEmail?.toLowerCase(),
        contactPhone: input.contactPhone,
        status: ProspectStatus.UNCLAIMED,
      },
      update: {
        displayName: input.displayName,
        locationCountry: input.locationCountry,
        locationCity: input.locationCity,
        categories: input.categories ?? undefined,
        followerEstimate: input.followerEstimate,
        contactEmail: input.contactEmail?.toLowerCase(),
        contactPhone: input.contactPhone,
      },
    });
    await this.prisma.auditEvent.create({
      data: {
        actorId: userId,
        action: 'prospect.upsert',
        targetType: 'CreatorProspect',
        targetId: prospect.id,
        after: { channel: prospect.channel, handle: prospect.handle },
      },
    });
    return this.presentProspect(prospect);
  }

  async getProspect(id: string, userId?: string, brandId?: string) {
    const prospect = await this.prisma.creatorProspect.findUnique({
      where: { id },
    });
    if (!prospect) throw new NotFoundException('Prospect not found.');
    const presented = this.presentProspect(prospect);
    if (!userId) return presented;
    const flags = await this.loadRelationshipFlags(userId, brandId, [], [id]);
    return {
      ...presented,
      saved: flags.saved.has(id),
      interested: flags.interestedProspects.has(id),
    };
  }

  async getCreator(id: string, userId: string, brandId?: string) {
    const claimed = await this.prisma.creatorProfile.findUnique({
      where: { id },
    });
    if (claimed) {
      return this.getClaimedCreator(id, userId, brandId);
    }
    return this.getProspect(id, userId, brandId);
  }

  async saveCreator(userId: string, id: string, brandId?: string) {
    const ctx = await this.workspace.requireOrganisation(userId, brandId);
    if (!ctx.organisation) {
      throw new ForbiddenException('Organisation workspace required.');
    }
    const profile = await this.prisma.creatorProfile.findUnique({
      where: { id },
      select: { id: true },
    });
    const prospect = profile
      ? null
      : await this.prisma.creatorProspect.findUnique({
          where: { id },
          select: { id: true, claimedProfileId: true },
        });
    const creatorProfileId = profile?.id ?? prospect?.claimedProfileId ?? null;
    const prospectId = creatorProfileId ? null : prospect?.id ?? null;
    if (!creatorProfileId && !prospectId) {
      throw new NotFoundException('Creator not found.');
    }

    const list = await this.ensureSavedList(ctx.organisation.id, ctx.activeBrandId);
    if (creatorProfileId) {
      await this.prisma.creatorListItem.upsert({
        where: {
          listId_creatorProfileId: { listId: list.id, creatorProfileId },
        },
        create: { listId: list.id, creatorProfileId },
        update: {},
      });
    } else if (prospectId) {
      await this.prisma.creatorListItem.upsert({
        where: {
          listId_prospectId: { listId: list.id, prospectId },
        },
        create: { listId: list.id, prospectId },
        update: {},
      });
    }
    await this.analytics.recordBestEffort({
      eventType: 'CREATOR_SAVED',
      actorUserId: userId,
      organisationId: ctx.organisation.id,
      brandId: ctx.activeBrandId ?? undefined,
      creatorProfileId: creatorProfileId ?? undefined,
    });
    return { ok: true, saved: true };
  }

  async unsaveCreator(userId: string, id: string) {
    const ctx = await this.workspace.requireOrganisation(userId);
    if (!ctx.organisation) {
      throw new ForbiddenException('Organisation workspace required.');
    }
    const items = await this.prisma.creatorListItem.findMany({
      where: {
        list: { organisationId: ctx.organisation.id },
        OR: [{ creatorProfileId: id }, { prospectId: id }],
      },
    });
    if (items.length) {
      await this.prisma.creatorListItem.deleteMany({
        where: { id: { in: items.map((item) => item.id) } },
      });
      await this.analytics.recordBestEffort({
        eventType: 'CREATOR_UNSAVED',
        actorUserId: userId,
        organisationId: ctx.organisation.id,
        creatorProfileId: items.find((item) => item.creatorProfileId)?.creatorProfileId ?? undefined,
      });
    }
    return { ok: true, saved: false };
  }

  private async ensureSavedList(organisationId: string, activeBrandId?: string | null) {
    const existing = await this.prisma.creatorList.findFirst({
      where: { organisationId, name: 'Saved creators' },
    });
    if (existing) return existing;
    return this.prisma.creatorList.create({
      data: {
        organisationId,
        name: 'Saved creators',
        brandLinks: activeBrandId ? { create: { brandId: activeBrandId } } : undefined,
      },
    });
  }

  async expressInterest(userId: string, input: ExpressInterestDto) {
    if (!input.prospectId && !input.creatorProfileId) {
      throw new BadRequestException('Either prospectId or creatorProfileId is required.');
    }
    if (input.prospectId && input.creatorProfileId) {
      throw new BadRequestException('Choose either a prospect or a creator.');
    }

    const brandId = input.brandId;
    if (!brandId) {
      throw new BadRequestException('Select a brand first (body brandId or X-Brand-Id).');
    }
    await this.workspace.requireBrandAccess(userId, brandId);

    if (input.prospectId) {
      const prospect = await this.prisma.creatorProspect.findUnique({
        where: { id: input.prospectId },
      });
      if (!prospect) throw new NotFoundException('Prospect not found.');
      if (prospect.status === ProspectStatus.CLAIMED) {
        throw new BadRequestException('That handle has already been claimed.');
      }
    }
    if (input.creatorProfileId) {
      const profile = await this.prisma.creatorProfile.findUnique({
        where: { id: input.creatorProfileId },
        select: { id: true },
      });
      if (!profile) throw new NotFoundException('Creator not found.');
    }

    const existing = await this.prisma.brandInterest.findFirst({
      where: {
        brandId,
        prospectId: input.prospectId ?? null,
        creatorProfileId: input.creatorProfileId ?? null,
        status: { not: 'CLOSED' },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return {
        id: existing.id,
        status: existing.status,
        alreadyOpen: true,
        expiresAt: existing.claimTokenExpiresAt,
      };
    }

    const raw = newOpaqueToken();
    const expires = new Date();
    expires.setDate(expires.getDate() + 14);

    const interest = await this.prisma.brandInterest.create({
      data: {
        brandId,
        prospectId: input.prospectId,
        creatorProfileId: input.creatorProfileId,
        message: input.message,
        status: input.prospectId ? 'INVITED' : 'OPEN',
        claimToken: hashToken(raw),
        claimTokenExpiresAt: expires,
        createdById: userId,
      },
      include: {
        brand: true,
        prospect: true,
        creatorProfile: { include: { user: true } },
      },
    });

    if (input.prospectId) {
      await this.prisma.creatorProspect.update({
        where: { id: input.prospectId },
        data: { status: ProspectStatus.CLAIM_PENDING },
      });
    }

    const claimEmail = interest.prospect?.contactEmail?.trim().toLowerCase();
    if (interest.creatorProfile?.userId) {
      await this.notifyClaimedCreator(userId, interest);
    } else if (claimEmail) {
      await this.mail.sendBestEffort({
        ...claimInviteMessage({
          brandName: interest.brand.name,
          handle: interest.prospect?.handle ?? 'your handle',
          href: this.mail.frontendUrl(`/claim/${raw}`),
          note: interest.message,
        }),
        to: claimEmail,
      });
    } else if (input.prospectId) {
      this.logger.log(
        `Claim invite has no contact email. Link: ${this.mail.frontendUrl(`/claim/${raw}`)} for @${interest.prospect?.handle}`,
      );
    }

    await this.prisma.auditEvent.create({
      data: {
        actorId: userId,
        action: 'brand.interest.create',
        targetType: 'BrandInterest',
        targetId: interest.id,
      },
    });

    return {
      id: interest.id,
      status: interest.status,
      prospectId: interest.prospectId,
      creatorProfileId: interest.creatorProfileId,
      expiresAt: interest.claimTokenExpiresAt,
      message: interest.prospectId
        ? claimEmail
          ? this.mail.configured()
            ? 'Claim invite sent.'
            : 'Claim invite created. The link is logged in the Nest console until Resend is configured.'
          : 'Claim invite created. Add a contact email on the prospect to send it, or share the console link.'
        : 'The creator was notified in-app.',
    };
  }

  private async notifyClaimedCreator(
    actorId: string,
    interest: {
      id: string;
      brandId: string;
      creatorProfileId: string | null;
      message: string | null;
      brand: { name: string };
      creatorProfile: { userId: string; displayName: string } | null;
    },
  ) {
    const creatorProfileId = interest.creatorProfileId;
    const notifyUserId = interest.creatorProfile?.userId;
    if (!creatorProfileId || !notifyUserId) return;

    const conversation =
      (await this.prisma.conversation.findFirst({
        where: {
          type: 'SUPPORT',
          brandId: interest.brandId,
          creatorProfileId,
        },
        orderBy: { createdAt: 'desc' },
      })) ??
      (await this.prisma.conversation.create({
        data: {
          type: 'SUPPORT',
          brandId: interest.brandId,
          creatorProfileId,
        },
      }));

    await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderUserId: actorId,
        body:
          interest.message ||
          `Hi ${interest.creatorProfile?.displayName || 'there'} — ${interest.brand.name} would like to work with you.`,
      },
    });
    await this.prisma.notification.create({
      data: {
        userId: notifyUserId,
        type: 'brand.interest',
        title: `${interest.brand.name} is interested`,
        body: interest.message || 'A brand wants to work with you on Woosh.',
        href: `/app/messages?c=${conversation.id}`,
        dedupeKey: `brand-interest:${interest.id}`,
      },
    });
  }

  private async getClaimedCreator(id: string, userId: string, brandId?: string) {
    const profile = await this.prisma.creatorProfile.findUnique({
      where: { id },
      include: {
        socialAccounts: {
          where: { status: 'ACTIVE' },
          include: {
            snapshots: {
              where: { source: { not: 'manual_unverified' } },
              take: 1,
              orderBy: { capturedAt: 'desc' },
            },
          },
        },
        portfolioItems: {
          where: { status: 'APPROVED' },
          orderBy: { sortOrder: 'asc' },
        },
        ratePackages: { where: { active: true }, orderBy: { sortOrder: 'asc' } },
        user: { select: { id: true, isPlatformAdmin: true } },
      },
    });
    if (!profile) throw new NotFoundException('Creator not found.');

    const publicProfile =
      profile.profileVisible && profile.marketplaceStatus === 'PUBLISHED';
    const owner = userId === profile.userId;
    const viewer = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isPlatformAdmin: true },
    });
    let allowed = publicProfile || owner || Boolean(viewer?.isPlatformAdmin);
    if (!allowed && brandId) {
      const relationship = await this.prisma.creatorProfile.count({
        where: {
          id,
          OR: [
            { brandInterests: { some: { brandId } } },
            { invitations: { some: { brief: { brandId } } } },
            { applications: { some: { brief: { brandId } } } },
            { participants: { some: { campaign: { brandId } } } },
          ],
        },
      });
      allowed = relationship > 0;
    }
    if (!allowed) throw new ForbiddenException('This profile is not available.');

    if (userId !== profile.userId) {
      let organisationId: string | undefined;
      if (brandId) {
        const brand = await this.prisma.brand.findUnique({
          where: { id: brandId },
          select: { organisationId: true },
        });
        organisationId = brand?.organisationId;
      }
      await this.analytics.recordBestEffort({
        eventType: 'PROFILE_VIEW',
        actorUserId: userId,
        organisationId,
        brandId,
        creatorProfileId: id,
        dedupePerDay: true,
      });
    }

    const flags = await this.loadRelationshipFlags(userId, brandId, [id], []);

    return {
      type: 'claimed' as const,
      id: profile.id,
      displayName: profile.displayName,
      bio: profile.bio,
      locationCountry: profile.locationCountry,
      locationCity: profile.locationCity,
      categories: profile.categories,
      languages: profile.languages,
      verified: Boolean(profile.verifiedAt),
      marketplaceStatus: profile.marketplaceStatus,
      saved: flags.saved.has(id),
      interested: flags.interestedCreators.has(id),
      socialAccounts: profile.socialAccounts.map((account) => ({
        channel: account.channel,
        handle: account.handle,
        metrics: account.snapshots[0]
          ? {
              followers: account.snapshots[0].followers,
              engagementRate: asNumber(account.snapshots[0].engagementRate),
              averageViews: account.snapshots[0].averageViews,
              source: account.snapshots[0].source,
              capturedAt: account.snapshots[0].capturedAt,
            }
          : null,
      })),
      ratePackages: profile.ratePackages.map((rate) => ({
        id: rate.id,
        title: rate.title,
        channel: rate.channel,
        deliverableType: rate.deliverableType,
        price: Number(rate.price),
        currency: rate.currency,
      })),
      portfolio: profile.portfolioItems.map((item) => ({
        id: item.id,
        title: item.title,
        url: item.url,
        mediaType: item.mediaType,
      })),
    };
  }

  private async listClaimed(filters: DiscoveryQueryDto, q?: string): Promise<DiscoveryItem[]> {
    const profiles = await this.prisma.creatorProfile.findMany({
      where: {
        profileVisible: true,
        marketplaceStatus: 'PUBLISHED',
        socialAccounts: {
          some: {
            status: 'ACTIVE',
            snapshots: { some: { source: { not: 'manual_unverified' } } },
          },
        },
        ...(filters.category ? { categories: { has: filters.category } } : {}),
        ...(filters.country ? { locationCountry: filters.country } : {}),
        ...(filters.city
          ? { locationCity: { contains: filters.city, mode: 'insensitive' } }
          : {}),
        ...(filters.language ? { languages: { has: filters.language } } : {}),
        ...(q
          ? {
              OR: [
                { displayName: { contains: q, mode: 'insensitive' } },
                { bio: { contains: q, mode: 'insensitive' } },
                {
                  socialAccounts: {
                    some: { handle: { contains: q, mode: 'insensitive' } },
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        socialAccounts: {
          where: {
            status: 'ACTIVE',
            ...(filters.channel ? { channel: filters.channel } : {}),
          },
          include: {
            snapshots: {
              where: { source: { not: 'manual_unverified' } },
              orderBy: { capturedAt: 'desc' as const },
              take: 1,
            },
          },
          take: 3,
        },
        ratePackages: {
          where: { active: true },
          orderBy: { price: 'asc' },
          take: 1,
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const items: DiscoveryItem[] = [];
    for (const profile of profiles) {
      if (filters.channel && profile.socialAccounts.length === 0) continue;
      const metrics = profile.socialAccounts
        .map((account) => account.snapshots[0])
        .filter((snapshot): snapshot is NonNullable<typeof snapshot> => !!snapshot);
      const followers = Math.max(0, ...metrics.map((row) => row.followers ?? 0));
      const engagementRate = Math.max(
        0,
        ...metrics.map((row) => Number(row.engagementRate ?? 0)),
      );
      const averageViews = Math.max(0, ...metrics.map((row) => row.averageViews ?? 0));
      const startingRate = profile.ratePackages[0]
        ? Number(profile.ratePackages[0].price)
        : asNumber(profile.typicalRateMin);
      if (filters.minFollowers && followers < filters.minFollowers) continue;
      if (filters.minEngagement && engagementRate < filters.minEngagement) continue;
      if (filters.minAverageViews && averageViews < filters.minAverageViews) continue;
      if (filters.maxRate && (startingRate == null || startingRate > filters.maxRate)) {
        continue;
      }
      const primary = profile.socialAccounts[0];
      items.push({
        id: profile.id,
        type: 'claimed',
        displayName: profile.displayName,
        channel: primary?.channel,
        channels: profile.socialAccounts.map((account) => account.channel),
        handle: primary?.handle,
        locationCountry: profile.locationCountry,
        locationCity: profile.locationCity,
        categories: profile.categories,
        followers: followers || null,
        engagementRate: engagementRate || null,
        averageViews: averageViews || null,
        metricsVerified: true,
        verified: Boolean(profile.verifiedAt),
        status: 'CLAIMED',
        startingRate,
        rateCurrency: profile.ratePackages[0]?.currency ?? profile.rateCurrency,
      });
    }
    return items;
  }

  private async listProspects(filters: DiscoveryQueryDto, q?: string): Promise<DiscoveryItem[]> {
    const prospects = await this.prisma.creatorProspect.findMany({
      where: {
        status: { in: [ProspectStatus.UNCLAIMED, ProspectStatus.CLAIM_PENDING] },
        graphStatus: 'ok',
        ...(filters.channel ? { channel: filters.channel } : {}),
        ...(filters.category ? { categories: { has: filters.category } } : {}),
        ...(filters.country ? { locationCountry: filters.country } : {}),
        ...(filters.city
          ? { locationCity: { contains: filters.city, mode: 'insensitive' } }
          : {}),
        ...(filters.minFollowers
          ? { followerEstimate: { gte: filters.minFollowers } }
          : { followerEstimate: { not: null } }),
        ...(filters.minEngagement
          ? { engagementRate: { gte: filters.minEngagement } }
          : {
              OR: [
                { engagementRate: { gt: 0 } },
                { averageLikes: { gt: 0 } },
              ],
            }),
        ...(filters.minAverageViews
          ? { averageViews: { gte: filters.minAverageViews } }
          : {}),
        ...(q
          ? {
              AND: [
                {
                  OR: [
                    { handle: { contains: q, mode: 'insensitive' } },
                    { displayName: { contains: q, mode: 'insensitive' } },
                  ],
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        channel: true,
        handle: true,
        displayName: true,
        avatarUrl: true,
        locationCountry: true,
        locationCity: true,
        categories: true,
        followerEstimate: true,
        engagementRate: true,
        averageLikes: true,
        averageViews: true,
        status: true,
      },
      orderBy: [
        { followerEstimate: { sort: 'desc', nulls: 'last' } },
        { updatedAt: 'desc' },
      ],
    });

    return prospects.map((prospect) => ({
      id: prospect.id,
      type: 'prospect' as const,
      displayName: prospect.displayName || `@${prospect.handle}`,
      channel: prospect.channel,
      channels: [prospect.channel],
      handle: prospect.handle,
      avatarUrl: prospect.avatarUrl,
      locationCountry: prospect.locationCountry,
      locationCity: prospect.locationCity,
      categories: prospect.categories,
      followerEstimate: prospect.followerEstimate,
      followers: prospect.followerEstimate,
      engagementRate: asNumber(prospect.engagementRate),
      averageLikes: nonNegativeInt(prospect.averageLikes),
      averageViews: nonNegativeInt(prospect.averageViews),
      metricsVerified: false,
      verified: false,
      status: prospect.status,
    }));
  }

  private async loadRelationshipFlags(
    userId: string,
    brandId: string | undefined,
    claimedIds: string[],
    prospectIds: string[],
  ) {
    const saved = new Set<string>();
    const interestedCreators = new Set<string>();
    const interestedProspects = new Set<string>();
    if (!claimedIds.length && !prospectIds.length) {
      return { saved, interestedCreators, interestedProspects };
    }

    const ctx = await this.workspace.getContext(userId, brandId);
    const organisationId = ctx.organisation?.id;
    const activeBrandId = brandId || ctx.activeBrandId || undefined;

    if (organisationId && (claimedIds.length || prospectIds.length)) {
      const items = await this.prisma.creatorListItem.findMany({
        where: {
          list: { organisationId, name: 'Saved creators' },
          OR: [
            ...(claimedIds.length ? [{ creatorProfileId: { in: claimedIds } }] : []),
            ...(prospectIds.length ? [{ prospectId: { in: prospectIds } }] : []),
          ],
        },
        select: { creatorProfileId: true, prospectId: true },
      });
      for (const item of items) {
        if (item.creatorProfileId) saved.add(item.creatorProfileId);
        if (item.prospectId) saved.add(item.prospectId);
      }
    }

    if (activeBrandId) {
      const interests = await this.prisma.brandInterest.findMany({
        where: {
          brandId: activeBrandId,
          status: { not: 'CLOSED' },
          OR: [
            ...(claimedIds.length
              ? [{ creatorProfileId: { in: claimedIds } }]
              : []),
            ...(prospectIds.length ? [{ prospectId: { in: prospectIds } }] : []),
          ],
        },
        select: { creatorProfileId: true, prospectId: true },
      });
      for (const row of interests) {
        if (row.creatorProfileId) interestedCreators.add(row.creatorProfileId);
        if (row.prospectId) interestedProspects.add(row.prospectId);
      }
    }

    return { saved, interestedCreators, interestedProspects };
  }

  private presentProspect(prospect: {
    id: string;
    channel: SocialChannel;
    handle: string;
    displayName: string | null;
    locationCountry: string | null;
    locationCity: string | null;
    categories: string[];
    followerEstimate: number | null;
    contactEmail: string | null;
    status: ProspectStatus;
    avatarUrl?: string | null;
    biography?: string | null;
    website?: string | null;
    mediaCount?: number | null;
    engagementRate?: { toNumber?: () => number } | number | null;
    averageLikes?: number | null;
    averageComments?: number | null;
    averageViews?: number | null;
    metricSampleSize?: number | null;
    graphPayload?: Prisma.JsonValue | null;
  }) {
    return {
      type: 'prospect' as const,
      id: prospect.id,
      channel: prospect.channel,
      handle: prospect.handle,
      displayName: prospect.displayName || `@${prospect.handle}`,
      locationCountry: prospect.locationCountry,
      locationCity: prospect.locationCity,
      categories: prospect.categories,
      followerEstimate: prospect.followerEstimate,
      followers: prospect.followerEstimate,
      avatarUrl: prospect.avatarUrl ?? null,
      biography: prospect.biography ?? null,
      website: prospect.website ?? null,
      mediaCount: prospect.mediaCount ?? null,
      engagementRate: asNumber(prospect.engagementRate),
      averageLikes: nonNegativeInt(prospect.averageLikes),
      averageComments: nonNegativeInt(prospect.averageComments),
      averageViews: nonNegativeInt(prospect.averageViews),
      metricSampleSize: prospect.metricSampleSize ?? null,
      recentPosts: recentPostsFromPayload(prospect.graphPayload),
      metricsVerified: false,
      status: prospect.status,
      contactEmail: prospect.contactEmail,
    };
  }
}

function nonNegativeInt(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function recentPostsFromPayload(payload: Prisma.JsonValue | null | undefined) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const media = (payload as { media?: { data?: Array<Record<string, unknown>> } }).media
    ?.data;
  if (!Array.isArray(media)) return [];
  return media.slice(0, 3).map((post, index) => ({
    id: typeof post.id === 'string' ? post.id : String(index),
    mediaType:
      typeof post.media_type === 'string'
        ? post.media_type
        : typeof post.media_product_type === 'string'
          ? post.media_product_type
          : null,
    permalink: typeof post.permalink === 'string' ? post.permalink : null,
    imageUrl:
      typeof post.thumbnail_url === 'string'
        ? post.thumbnail_url
        : typeof post.media_url === 'string'
          ? post.media_url
          : null,
    likeCount: typeof post.like_count === 'number' ? post.like_count : null,
    commentsCount:
      typeof post.comments_count === 'number' ? post.comments_count : null,
    timestamp: typeof post.timestamp === 'string' ? post.timestamp : null,
  }));
}
