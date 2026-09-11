import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { asNumber, normalizeHandle } from './handle';
import { oauthPublicStatus } from './oauth-config';
import { creatorReadiness } from './readiness';
import type { ConnectSocialDto } from './dto/connect-social.dto';
import type { CreateRatePackageDto } from './dto/create-rate.dto';
import type { UpdateCreatorProfileDto } from './dto/update-profile.dto';

@Injectable()
export class CreatorProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getMine(creatorProfileId: string) {
    const profile = await this.loadOwn(creatorProfileId);
    return this.presentOwn(profile);
  }

  async updateMine(creatorProfileId: string, userId: string, input: UpdateCreatorProfileDto) {
    await this.prisma.creatorProfile.update({
      where: { id: creatorProfileId },
      data: {
        displayName: input.displayName.trim(),
        bio: input.bio,
        websiteUrl: input.websiteUrl,
        locationCountry: input.locationCountry,
        locationState: input.locationState,
        locationCity: input.locationCity,
        categories: input.categories,
        languages: input.languages,
        preferredIndustries: input.preferredIndustries,
        excludedIndustries: input.excludedIndustries,
        ageBand: input.ageBand,
        gender: input.gender,
        ageSearchable: input.ageSearchable,
        genderSearchable: input.genderSearchable,
        typicalRateMin: input.typicalRateMin,
        typicalRateMax: input.typicalRateMax,
        rateCurrency: input.rateCurrency,
        availabilityNotes: input.availabilityNotes,
      },
    });
    await this.prisma.auditEvent.create({
      data: {
        actorId: userId,
        action: 'creator.profile.update',
        targetType: 'CreatorProfile',
        targetId: creatorProfileId,
      },
    });
    return this.getMine(creatorProfileId);
  }

  async submitForReview(creatorProfileId: string, userId: string) {
    const profile = await this.loadOwn(creatorProfileId);
    const readiness = creatorReadiness({
      ...profile,
      socialAccounts: profile.socialAccounts.map((account) => ({
        status: account.status,
        snapshots: account.snapshots.map((snapshot) => ({
          source: snapshot.source,
          followers: snapshot.followers,
        })),
      })),
    });
    if (!readiness.complete) {
      throw new BadRequestException(
        `Complete your profile first: ${readiness.checks
          .filter((check) => !check.complete)
          .map((check) => check.label)
          .join(', ')}`,
      );
    }
    await this.prisma.creatorProfile.update({
      where: { id: profile.id },
      data: {
        marketplaceStatus: 'PENDING_REVIEW',
        submittedAt: new Date(),
        profileVisible: false,
        moderationNotes: null,
      },
    });
    await this.prisma.auditEvent.create({
      data: {
        actorId: userId,
        action: 'creator.profile.submit_review',
        targetType: 'CreatorProfile',
        targetId: profile.id,
      },
    });
    return this.getMine(creatorProfileId);
  }

  async createRate(creatorProfileId: string, userId: string, input: CreateRatePackageDto) {
    const sortOrder = await this.prisma.creatorRatePackage.count({
      where: { creatorProfileId },
    });
    const rate = await this.prisma.creatorRatePackage.create({
      data: {
        creatorProfileId,
        channel: input.channel,
        deliverableType: input.deliverableType,
        title: input.title,
        description: input.description,
        price: input.price,
        currency: input.currency ?? 'NGN',
        turnaroundDays: input.turnaroundDays,
        revisions: input.revisions ?? 1,
        usageRights: input.usageRights,
        sortOrder,
      },
    });
    await this.syncRateRange(creatorProfileId);
    await this.prisma.auditEvent.create({
      data: {
        actorId: userId,
        action: 'creator.rate.create',
        targetType: 'CreatorRatePackage',
        targetId: rate.id,
      },
    });
    return this.getMine(creatorProfileId);
  }

  async deleteRate(creatorProfileId: string, userId: string, ratePackageId: string) {
    const rate = await this.prisma.creatorRatePackage.findFirst({
      where: { id: ratePackageId, creatorProfileId },
    });
    if (!rate) throw new NotFoundException('Rate package not found.');
    await this.prisma.creatorRatePackage.delete({ where: { id: rate.id } });
    await this.syncRateRange(creatorProfileId);
    await this.prisma.auditEvent.create({
      data: {
        actorId: userId,
        action: 'creator.rate.delete',
        targetType: 'CreatorRatePackage',
        targetId: rate.id,
      },
    });
    return this.getMine(creatorProfileId);
  }

  async connectSocial(creatorProfileId: string, userId: string, input: ConnectSocialDto) {
    const handle =
      (input.handleHint ? normalizeHandle(input.handleHint) : '') ||
      `${input.channel.toLowerCase()}-pending-${creatorProfileId.slice(-6)}`;

    const account = await this.prisma.socialAccount.upsert({
      where: {
        channel_externalId: { channel: input.channel, externalId: handle },
      },
      create: {
        creatorProfileId,
        channel: input.channel,
        externalId: handle,
        handle,
        status: 'PENDING',
      },
      update: {
        creatorProfileId,
        handle,
        status: 'PENDING',
      },
    });

    await this.prisma.auditEvent.create({
      data: {
        actorId: userId,
        action: 'creator.social.connect_start',
        targetType: 'SocialAccount',
        targetId: account.id,
        after: {
          channel: input.channel,
          status: 'PENDING',
          note: 'Metrics will sync from provider; no manual follower entry',
        },
      },
    });

    return {
      id: account.id,
      channel: account.channel,
      handle: account.handle,
      status: account.status,
      message:
        'Handle reserved as PENDING. OAuth must verify before metrics are live. Do not type a follower count.',
    };
  }

  private async syncRateRange(creatorProfileId: string) {
    const rates = await this.prisma.creatorRatePackage.findMany({
      where: { creatorProfileId, active: true },
      select: { price: true, currency: true },
    });
    const values = rates.map((rate) => Number(rate.price));
    await this.prisma.creatorProfile.update({
      where: { id: creatorProfileId },
      data: {
        typicalRateMin: values.length ? Math.min(...values) : null,
        typicalRateMax: values.length ? Math.max(...values) : null,
        rateCurrency: rates[0]?.currency ?? 'NGN',
      },
    });
  }

  private async loadOwn(creatorProfileId: string) {
    const profile = await this.prisma.creatorProfile.findUnique({
      where: { id: creatorProfileId },
      include: {
        user: { select: { emailVerified: true } },
        socialAccounts: {
          include: {
            snapshots: { orderBy: { capturedAt: 'desc' as const }, take: 1 },
          },
        },
        portfolioItems: { orderBy: { sortOrder: 'asc' as const } },
        ratePackages: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!profile) throw new ForbiddenException('Creator workspace required.');
    return profile;
  }

  private presentOwn(
    profile: Awaited<ReturnType<CreatorProfileService['loadOwn']>>,
  ) {
    return {
      id: profile.id,
      displayName: profile.displayName,
      bio: profile.bio,
      websiteUrl: profile.websiteUrl,
      locationCountry: profile.locationCountry,
      locationState: profile.locationState,
      locationCity: profile.locationCity,
      categories: profile.categories,
      languages: profile.languages,
      preferredIndustries: profile.preferredIndustries,
      excludedIndustries: profile.excludedIndustries,
      ageBand: profile.ageBand,
      gender: profile.gender,
      ageSearchable: profile.ageSearchable,
      genderSearchable: profile.genderSearchable,
      typicalRateMin: asNumber(profile.typicalRateMin),
      typicalRateMax: asNumber(profile.typicalRateMax),
      rateCurrency: profile.rateCurrency,
      availabilityNotes: profile.availabilityNotes,
      avatarUrl: profile.avatarUrl,
      avatarStatus: profile.avatarStatus,
      coverUrl: profile.coverUrl,
      coverStatus: profile.coverStatus,
      marketplaceStatus: profile.marketplaceStatus,
      profileVisible: profile.profileVisible,
      submittedAt: profile.submittedAt,
      verifiedAt: profile.verifiedAt,
      socialAccounts: profile.socialAccounts.map((account) => ({
        id: account.id,
        channel: account.channel,
        handle: account.handle,
        status: account.status,
        lastRefreshedAt: account.lastRefreshedAt,
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
        channel: rate.channel,
        deliverableType: rate.deliverableType,
        title: rate.title,
        description: rate.description,
        price: Number(rate.price),
        currency: rate.currency,
        turnaroundDays: rate.turnaroundDays,
        revisions: rate.revisions,
        usageRights: rate.usageRights,
        active: rate.active,
      })),
      portfolioItems: profile.portfolioItems.map((item) => ({
        id: item.id,
        mediaType: item.mediaType,
        title: item.title,
        description: item.description,
        channel: item.channel,
        campaignType: item.campaignType,
        brandName: item.brandName,
        tags: item.tags,
        url: item.url,
        status: item.status,
        moderationNotes: item.moderationNotes,
        sortOrder: item.sortOrder,
      })),
      portfolioCount: profile.portfolioItems.length,
      oauth: oauthPublicStatus(),
      readiness: creatorReadiness({
        ...profile,
        socialAccounts: profile.socialAccounts.map((account) => ({
          status: account.status,
          snapshots: account.snapshots.map((snapshot) => ({
            source: snapshot.source,
            followers: snapshot.followers,
          })),
        })),
      }),
    };
  }
}
