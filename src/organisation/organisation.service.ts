import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { MembershipRole, OrganisationType } from '@prisma/client';
import { BRAND_INDUSTRIES } from '../common/taxonomy';
import { hashToken, newOpaqueToken } from '../common/crypto/tokens';
import { MailService } from '../mail/mail.service';
import { teamInviteMessage, teammateAddedMessage } from '../mail/templates';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateBrandDto } from './dto/create-brand.dto';
import type { InviteTeammateDto } from './dto/invite-teammate.dto';
import type { UpdateBrandDto } from './dto/update-brand.dto';
import type { UpdateOrganisationDto } from './dto/update-organisation.dto';
import { WorkspaceService } from './workspace.service';
import type { WorkspaceSnapshot } from './workspace.types';

const INVITE_DAYS = 7;

@Injectable()
export class OrganisationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
    private readonly mail: MailService,
  ) {}

  getWorkspace(userId: string, preferredBrandId?: string) {
    return this.workspace.getContext(userId, preferredBrandId);
  }

  switchBrand(userId: string, brandId: string) {
    return this.workspace.requireBrandAccess(userId, brandId);
  }

  async updateOrganisation(
    ctx: WorkspaceSnapshot,
    input: UpdateOrganisationDto,
  ) {
    const organisationId = ctx.organisation!.id;
    const org = await this.prisma.organisation.update({
      where: { id: organisationId },
      data: {
        publicName: input.publicName?.trim(),
        website: input.website?.trim() || undefined,
        industry: this.normalizeIndustry(input.industry),
      },
    });
    await this.audit(ctx.user.id, 'organisation.update', 'Organisation', organisationId);
    return this.workspace.presentOrganisation(org);
  }

  async createBrand(ctx: WorkspaceSnapshot, input: CreateBrandDto) {
    const org = ctx.organisation!;
    if (org.type !== OrganisationType.AGENCY && org.type !== OrganisationType.PLATFORM) {
      throw new ForbiddenException(
        'Brand seats have exactly one brand. Agencies add client brands here.',
      );
    }

    const brand = await this.prisma.$transaction(async (tx) => {
      const created = await tx.brand.create({
        data: {
          organisationId: org.id,
          name: input.name.trim(),
          industry: input.industry,
          country: (input.country ?? 'NG').toUpperCase(),
        },
      });
      const wallet = await tx.brandWallet.create({
        data: { brandId: created.id, currency: 'NGN' },
      });
      await tx.brandMembership.create({
        data: {
          brandId: created.id,
          userId: ctx.user.id,
          role: MembershipRole.OWNER,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorId: ctx.user.id,
          action: 'brand.create',
          targetType: 'Brand',
          targetId: created.id,
          after: { name: created.name, organisationId: org.id },
        },
      });
      return { ...created, wallet };
    });

    return this.workspace.presentBrand(brand);
  }

  async updateBrand(
    ctx: WorkspaceSnapshot,
    brandId: string,
    input: UpdateBrandDto,
  ) {
    const existing = await this.prisma.brand.findUnique({
      where: { id: brandId },
      include: { wallet: true },
    });
    if (!existing || existing.organisationId !== ctx.organisation!.id) {
      throw new NotFoundException('Brand not found.');
    }

    const updated = await this.prisma.brand.update({
      where: { id: brandId },
      data: {
        name: input.name?.trim(),
        country: input.country?.toUpperCase(),
        industry:
          input.industry === undefined
            ? undefined
            : this.normalizeIndustry(input.industry),
      },
      include: { wallet: true },
    });
    await this.audit(ctx.user.id, 'brand.update', 'Brand', brandId, {
      before: { name: existing.name, industry: existing.industry },
      after: { name: updated.name, industry: updated.industry },
    });
    return this.workspace.presentBrand(updated);
  }

  async listTeam(ctx: WorkspaceSnapshot) {
    const organisationId = ctx.organisation!.id;
    const [members, pendingInvites] = await Promise.all([
      this.prisma.membership.findMany({
        where: { organisationId },
        include: {
          user: { select: { id: true, email: true, name: true, image: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.teamInvite.findMany({
        where: { organisationId, acceptedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          role: true,
          expiresAt: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      members: members.map((row) => ({
        userId: row.user.id,
        email: row.user.email,
        name: row.user.name,
        image: row.user.image,
        role: row.role,
        canApprovePayments: row.canApprovePayments,
        canEditRates: row.canEditRates,
        canManageTeam: row.canManageTeam,
        canExportData: row.canExportData,
        createdAt: row.createdAt,
      })),
      pendingInvites,
    };
  }

  async previewInvite(rawToken: string) {
    const token = rawToken?.trim();
    if (!token) throw new BadRequestException('Invite not found or expired.');
    const invite = await this.prisma.teamInvite.findUnique({
      where: { token: hashToken(token) },
      include: { organisation: { select: { publicName: true } } },
    });
    if (!invite || invite.expiresAt < new Date() || invite.acceptedAt) {
      throw new BadRequestException('Invite not found or expired.');
    }
    return {
      email: invite.email,
      orgName: invite.organisation.publicName,
      role: invite.role,
    };
  }

  async inviteTeammate(ctx: WorkspaceSnapshot, input: InviteTeammateDto) {
    const organisationId = ctx.organisation!.id;
    const inviterRole = ctx.membership?.role;
    if (
      input.role === MembershipRole.ADMIN &&
      inviterRole !== MembershipRole.OWNER &&
      inviterRole !== MembershipRole.ADMIN &&
      !ctx.user.isPlatformAdmin
    ) {
      throw new ForbiddenException('You cannot assign that role.');
    }

    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    const currentMembership = existing
      ? await this.prisma.membership.findUnique({
          where: {
            organisationId_userId: {
              organisationId,
              userId: existing.id,
            },
          },
        })
      : null;

    if (existing?.id === ctx.user.id || currentMembership?.role === MembershipRole.OWNER) {
      throw new ConflictException('Use member management to change an existing owner.');
    }

    const raw = newOpaqueToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITE_DAYS);

    const invite = await this.prisma.teamInvite.create({
      data: {
        organisationId,
        email,
        role: input.role,
        token: hashToken(raw),
        invitedById: ctx.user.id,
        expiresAt,
      },
    });

    await this.prisma.notification.create({
      data: {
        userId: ctx.user.id,
        type: 'team.invite.sent',
        title: 'Invite sent',
        body: `Invite emailed to ${email} (${input.role}).`,
        href: '/app/team',
      },
    });
    await this.audit(ctx.user.id, 'organisation.invite.sent', 'TeamInvite', invite.id, {
      after: { email, role: input.role },
    });

    if (existing) {
      await this.prisma.membership.upsert({
        where: {
          organisationId_userId: {
            organisationId,
            userId: existing.id,
          },
        },
        create: {
          organisationId,
          userId: existing.id,
          role: input.role,
        },
        update: { role: input.role },
      });
      await this.prisma.teamInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
      await this.prisma.notification.create({
        data: {
          userId: existing.id,
          type: 'team.invite.accepted',
          title: "You've been added to a workspace",
          body: ctx.organisation!.publicName,
          href: '/app',
        },
      });
      await this.mail.sendBestEffort({
        ...teammateAddedMessage({
          orgName: ctx.organisation!.publicName,
          href: this.mail.frontendUrl('/app'),
        }),
        to: email,
      });
      return {
        ok: true,
        status: 'added' as const,
        email,
        role: input.role,
        message: 'Existing account added to the workspace.',
      };
    }

    const roleLabel = input.role.replaceAll('_', ' ').toLowerCase();
    await this.mail.sendBestEffort({
      ...teamInviteMessage({
        orgName: ctx.organisation!.publicName,
        role: roleLabel,
        href: this.mail.frontendUrl(
          `/invite?token=${raw}&email=${encodeURIComponent(email)}`,
        ),
      }),
      to: email,
    });
    return {
      ok: true,
      status: 'invited' as const,
      email,
      role: input.role,
      expiresAt,
      message: this.mail.configured()
        ? 'Invite sent.'
        : 'Invite created. The accept link is logged in the Nest console until Resend is configured.',
    };
  }

  async acceptInvite(userId: string, rawToken: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const invite = await this.prisma.teamInvite.findUnique({
      where: { token: hashToken(rawToken) },
    });
    if (!invite) {
      throw new BadRequestException('Invite not found.');
    }
    if (invite.expiresAt < new Date()) {
      throw new BadRequestException('Invite expired.');
    }
    if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new ForbiddenException('Invite email does not match this account.');
    }
    if (invite.acceptedAt) {
      return { ok: true, status: 'already_accepted' as const };
    }

    await this.prisma.$transaction([
      this.prisma.membership.upsert({
        where: {
          organisationId_userId: {
            organisationId: invite.organisationId,
            userId,
          },
        },
        create: {
          organisationId: invite.organisationId,
          userId,
          role: invite.role,
        },
        update: { role: invite.role },
      }),
      this.prisma.teamInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      }),
    ]);

    return { ok: true, status: 'accepted' as const };
  }

  private normalizeIndustry(industry?: string) {
    if (industry === undefined) return undefined;
    if (
      industry === '' ||
      !(BRAND_INDUSTRIES as readonly string[]).includes(industry)
    ) {
      return null;
    }
    return industry;
  }

  private async audit(
    actorId: string,
    action: string,
    targetType: string,
    targetId: string,
    extra?: { before?: object; after?: object },
  ) {
    await this.prisma.auditEvent.create({
      data: {
        actorId,
        action,
        targetType,
        targetId,
        before: extra?.before,
        after: extra?.after,
      },
    });
  }
}
