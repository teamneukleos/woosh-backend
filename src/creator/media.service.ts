import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreatorMediaStatus, PortfolioMediaType, Prisma } from '@prisma/client';
import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { validateUpload, type UploadKind } from '../storage/upload-policy';
import type {
  AddCampaignContentDto,
  CreatePortfolioEmbedDto,
  PortfolioMetaDto,
  ReorderPortfolioDto,
} from './dto/portfolio.dto';
import { CreatorProfileService } from './profile.service';

const EMBED_HOSTS = ['instagram.com', 'tiktok.com', 'youtube.com', 'youtu.be'];
const APPROVED_DELIVERABLE_STATES = ['APPROVED', 'LIVE', 'COMPLETED'];

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly profiles: CreatorProfileService,
  ) {}

  async uploadImage(
    creatorProfileId: string,
    userId: string,
    kind: 'avatar' | 'cover',
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  ) {
    this.validateFile(file, kind);
    const profile = await this.prisma.creatorProfile.findUniqueOrThrow({
      where: { id: creatorProfileId },
    });
    const stored = await this.storage.store({
      buffer: file.buffer,
      filename: file.originalname,
      contentType: file.mimetype,
      folder: `creators/${creatorProfileId}/${kind}`,
    });
    const oldKey = kind === 'avatar' ? profile.avatarStorageKey : profile.coverStorageKey;
    const demotePublished =
      profile.marketplaceStatus === 'PUBLISHED' ? 'PENDING_REVIEW' : profile.marketplaceStatus;

    await this.prisma.creatorProfile.update({
      where: { id: creatorProfileId },
      data:
        kind === 'avatar'
          ? {
              avatarUrl: stored.url,
              avatarStorageKey: stored.key,
              avatarStatus: CreatorMediaStatus.PENDING,
              marketplaceStatus: demotePublished,
            }
          : {
              coverUrl: stored.url,
              coverStorageKey: stored.key,
              coverStatus: CreatorMediaStatus.PENDING,
              marketplaceStatus: demotePublished,
            },
    });
    await this.storage.remove(oldKey);
    await this.audit(userId, `creator.${kind}.upload`, 'CreatorProfile', creatorProfileId);
    return this.profiles.getMine(creatorProfileId);
  }

  async addUpload(
    creatorProfileId: string,
    userId: string,
    meta: PortfolioMetaDto,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  ) {
    const isVideo = file.mimetype.startsWith('video/');
    const kind: UploadKind = isVideo ? 'portfolio-video' : 'portfolio-image';
    this.validateFile(file, kind);
    const stored = await this.storage.store({
      buffer: file.buffer,
      filename: file.originalname,
      contentType: file.mimetype,
      folder: `creators/${creatorProfileId}/portfolio`,
    });
    const item = await this.createItem(creatorProfileId, {
      mediaType: isVideo ? PortfolioMediaType.VIDEO : PortfolioMediaType.IMAGE,
      title: meta.title,
      description: meta.description,
      channel: meta.channel,
      campaignType: meta.campaignType,
      brandName: meta.brandName,
      tags: meta.tags ?? [],
      url: stored.url,
      storageKey: stored.key,
      mimeType: file.mimetype,
      fileSizeBytes: file.size,
    });
    await this.audit(userId, 'creator.portfolio.upload', 'CreatorPortfolioItem', item.id);
    return this.profiles.getMine(creatorProfileId);
  }

  async addEmbed(creatorProfileId: string, userId: string, input: CreatePortfolioEmbedDto) {
    const url = this.assertEmbedUrl(input.url);
    const item = await this.createItem(creatorProfileId, {
      mediaType: PortfolioMediaType.EMBED,
      title: input.title,
      description: input.description,
      channel: input.channel,
      campaignType: input.campaignType,
      brandName: input.brandName,
      tags: input.tags ?? [],
      url,
    });
    await this.audit(userId, 'creator.portfolio.embed', 'CreatorPortfolioItem', item.id);
    return this.profiles.getMine(creatorProfileId);
  }

  async addCampaignContent(
    creatorProfileId: string,
    userId: string,
    input: AddCampaignContentDto,
  ) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: input.submissionId },
      include: {
        deliverable: {
          include: {
            campaign: {
              include: {
                participants: { where: { creatorProfileId } },
              },
            },
          },
        },
      },
    });
    if (!submission || !submission.deliverable.campaign.participants.length) {
      throw new NotFoundException('Campaign content not found.');
    }
    if (!APPROVED_DELIVERABLE_STATES.includes(submission.deliverable.state)) {
      throw new BadRequestException('Only approved campaign content can be added.');
    }
    const url = submission.liveUrl || submission.draftUrl;
    if (!url) throw new BadRequestException('Submission has no media URL.');
    const pathname = new URL(url, 'http://localhost').pathname.toLowerCase();
    const mediaType = /\.(mp4|mov)$/.test(pathname)
      ? PortfolioMediaType.VIDEO
      : /\.(jpe?g|png|webp)$/.test(pathname)
        ? PortfolioMediaType.IMAGE
        : PortfolioMediaType.EMBED;
    const item = await this.createItem(creatorProfileId, {
      mediaType,
      title: input.title,
      description: `Created for ${submission.deliverable.campaign.title}`,
      channel: submission.deliverable.channel ?? undefined,
      campaignType: submission.deliverable.title,
      tags: [],
      url,
    });
    await this.audit(
      userId,
      'creator.portfolio.add_campaign_content',
      'CreatorPortfolioItem',
      item.id,
      { submissionId: submission.id },
    );
    return this.profiles.getMine(creatorProfileId);
  }

  async updateItem(
    creatorProfileId: string,
    userId: string,
    itemId: string,
    input: PortfolioMetaDto,
  ) {
    const existing = await this.prisma.creatorPortfolioItem.findFirst({
      where: { id: itemId, creatorProfileId },
    });
    if (!existing) throw new NotFoundException('Portfolio item not found.');
    await this.prisma.creatorPortfolioItem.update({
      where: { id: existing.id },
      data: {
        title: input.title,
        description: input.description,
        channel: input.channel,
        campaignType: input.campaignType,
        brandName: input.brandName,
        tags: input.tags ?? [],
        status:
          existing.status === CreatorMediaStatus.APPROVED
            ? CreatorMediaStatus.PENDING
            : existing.status,
        moderationNotes: null,
      },
    });
    await this.audit(userId, 'creator.portfolio.update', 'CreatorPortfolioItem', existing.id);
    return this.profiles.getMine(creatorProfileId);
  }

  async deleteItem(creatorProfileId: string, userId: string, itemId: string) {
    const item = await this.prisma.creatorPortfolioItem.findFirst({
      where: { id: itemId, creatorProfileId },
    });
    if (!item) throw new NotFoundException('Portfolio item not found.');
    await this.prisma.creatorPortfolioItem.delete({ where: { id: item.id } });
    await Promise.all([
      this.storage.remove(item.storageKey),
      this.storage.remove(item.thumbnailStorageKey),
    ]);
    await this.audit(userId, 'creator.portfolio.delete', 'CreatorPortfolioItem', item.id);
    return this.profiles.getMine(creatorProfileId);
  }

  async reorder(creatorProfileId: string, userId: string, input: ReorderPortfolioDto) {
    const owned = await this.prisma.creatorPortfolioItem.findMany({
      where: { creatorProfileId, id: { in: input.orderedIds } },
      select: { id: true },
    });
    if (owned.length !== input.orderedIds.length) {
      throw new BadRequestException('Portfolio order contains an invalid item.');
    }
    await this.prisma.$transaction(
      input.orderedIds.map((id, sortOrder) =>
        this.prisma.creatorPortfolioItem.update({
          where: { id },
          data: { sortOrder },
        }),
      ),
    );
    await this.audit(userId, 'creator.portfolio.reorder', 'CreatorProfile', creatorProfileId);
    return this.profiles.getMine(creatorProfileId);
  }

  async moderate(adminId: string, itemId: string, approve: boolean, reason?: string) {
    const item = await this.prisma.creatorPortfolioItem.findUnique({
      where: { id: itemId },
      include: { creator: { select: { displayName: true, userId: true } } },
    });
    if (!item) throw new NotFoundException('Portfolio item not found.');
    const updated = await this.prisma.creatorPortfolioItem.update({
      where: { id: item.id },
      data: {
        status: approve ? CreatorMediaStatus.APPROVED : CreatorMediaStatus.REJECTED,
        moderationNotes: approve ? null : reason || 'Needs changes',
        moderatedAt: new Date(),
        moderatedById: adminId,
      },
    });
    await this.prisma.notification.create({
      data: {
        userId: item.creator.userId,
        type: approve ? 'creator.media.approved' : 'creator.media.rejected',
        title: approve ? 'Portfolio item approved' : 'Portfolio item needs changes',
        body:
          reason ||
          (approve
            ? `${item.title} is now visible on your profile.`
            : `Update ${item.title} and resubmit.`),
        href: '/app/profile',
      },
    });
    await this.audit(
      adminId,
      approve ? 'creator.portfolio.approve' : 'creator.portfolio.reject',
      'CreatorPortfolioItem',
      item.id,
      { reason },
    );
    return {
      id: updated.id,
      status: updated.status,
    };
  }

  private validateFile(
    file: { buffer: Buffer; mimetype: string },
    kind: UploadKind,
  ) {
    try {
      validateUpload({
        buffer: file.buffer,
        contentType: file.mimetype,
        kind,
      });
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid upload',
      );
    }
  }

  private assertEmbedUrl(value: string) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new BadRequestException('Use an Instagram, TikTok, or YouTube URL.');
    }
    const host = parsed.hostname.replace(/^www\./, '');
    if (!EMBED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
      throw new BadRequestException('Use an Instagram, TikTok, or YouTube URL.');
    }
    return value;
  }

  private async createItem(
    creatorProfileId: string,
    data: {
      mediaType: PortfolioMediaType;
      title: string;
      description?: string;
      channel?: PortfolioMetaDto['channel'];
      campaignType?: string;
      brandName?: string;
      tags: string[];
      url: string;
      storageKey?: string;
      mimeType?: string;
      fileSizeBytes?: number;
    },
  ) {
    const count = await this.prisma.creatorPortfolioItem.count({
      where: { creatorProfileId },
    });
    return this.prisma.creatorPortfolioItem.create({
      data: {
        creatorProfileId,
        mediaType: data.mediaType,
        title: data.title,
        description: data.description,
        channel: data.channel,
        campaignType: data.campaignType,
        brandName: data.brandName,
        tags: data.tags,
        url: data.url,
        storageKey: data.storageKey,
        mimeType: data.mimeType,
        fileSizeBytes: data.fileSizeBytes,
        sortOrder: count,
        status: CreatorMediaStatus.PENDING,
      },
    });
  }

  private async audit(
    actorId: string,
    action: string,
    targetType: string,
    targetId: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    await this.prisma.auditEvent.create({
      data: { actorId, action, targetType, targetId, metadata },
    });
  }
}
