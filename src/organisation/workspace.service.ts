import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  MembershipRole,
  OrganisationType,
  UserStatus,
  type Brand,
  type BrandWallet,
} from '@prisma/client';
import {
  effectivePermissions,
  hasPermission,
  type Permission,
} from '../common/permissions';
import { seatFor } from '../common/seat';
import { PrismaService } from '../prisma/prisma.service';
import type {
  BrandSnapshot,
  MembershipSnapshot,
  OrganisationSnapshot,
  WorkspaceSnapshot,
} from './workspace.types';

type BrandWithWallet = Brand & { wallet: BrandWallet | null };

export type WorkActor = {
  userId: string;
  isPlatformAdmin: boolean;
  creatorProfileId: string | null;
  brandIds: string[];
};

@Injectable()
export class WorkspaceService {
  constructor(private readonly prisma: PrismaService) {}

  async getWorkActor(userId: string): Promise<WorkActor> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        status: true,
        emailVerified: true,
        isPlatformAdmin: true,
        creatorProfile: { select: { id: true } },
        memberships: {
          select: { organisation: { select: { brands: { select: { id: true } } } } },
        },
        brandMemberships: { select: { brandId: true } },
      },
    });
    if (!user || user.status !== UserStatus.ACTIVE || !user.emailVerified) {
      throw new UnauthorizedException('Account is not active.');
    }
    const brandIds = new Set(user.brandMemberships.map((row) => row.brandId));
    for (const membership of user.memberships) {
      for (const brand of membership.organisation.brands) brandIds.add(brand.id);
    }
    return {
      userId: user.id,
      isPlatformAdmin: user.isPlatformAdmin,
      creatorProfileId: user.creatorProfile?.id ?? null,
      brandIds: [...brandIds],
    };
  }

  async requireBrandPermission(
    userId: string,
    brandId: string,
    permission: Permission,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        isPlatformAdmin: true,
        memberships: {
          where: { organisation: { brands: { some: { id: brandId } } } },
          select: {
            role: true,
            canApprovePayments: true,
            canEditRates: true,
            canManageTeam: true,
            canExportData: true,
          },
        },
        brandMemberships: {
          where: { brandId },
          select: { role: true },
        },
      },
    });
    if (!user) throw new UnauthorizedException();
    const allowed =
      user.isPlatformAdmin ||
      user.memberships.some((membership) =>
        hasPermission(membership.role, permission, membership),
      ) ||
      user.brandMemberships.some((membership) =>
        hasPermission(membership.role, permission),
      );
    if (!allowed) {
      throw new ForbiddenException('You do not have permission for this action.');
    }
  }

  async requirePlatformAdmin(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isPlatformAdmin: true },
    });
    if (!user?.isPlatformAdmin) {
      throw new ForbiddenException('Platform admin required.');
    }
  }

  async getContext(
    userId: string,
    preferredBrandId?: string,
  ): Promise<WorkspaceSnapshot> {
    const user = await this.loadUser(userId);
    if (!user) throw new UnauthorizedException();
    if (user.status !== UserStatus.ACTIVE || !user.emailVerified) {
      throw new UnauthorizedException('Account is not active.');
    }

    const membership = user.memberships[0] ?? null;
    const organisation = membership?.organisation ?? null;
    const brands: BrandWithWallet[] = user.isPlatformAdmin
      ? (organisation?.brands ?? user.brandMemberships.map((row) => row.brand))
      : user.creatorProfile
        ? []
        : (organisation?.brands ?? []);

    const snapshots = brands.map((brand) => this.presentBrand(brand));
    const active =
      snapshots.find((brand) => brand.id === preferredBrandId) ??
      snapshots[0] ??
      null;

    return {
      seat: seatFor({
        isPlatformAdmin: user.isPlatformAdmin,
        hasCreatorProfile: Boolean(user.creatorProfile),
        organisationType: organisation?.type ?? null,
      }),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isPlatformAdmin: user.isPlatformAdmin,
      },
      organisation: organisation ? this.presentOrganisation(organisation) : null,
      membership: membership ? this.presentMembership(membership) : null,
      brands: snapshots,
      activeBrandId: active?.id ?? null,
      activeBrand: active,
    };
  }

  async requireOrganisation(
    userId: string,
    preferredBrandId?: string,
  ): Promise<WorkspaceSnapshot & { organisation: OrganisationSnapshot }> {
    const ctx = await this.getContext(userId, preferredBrandId);
    if (!ctx.organisation) {
      throw new ForbiddenException('Organisation workspace required.');
    }
    return ctx as WorkspaceSnapshot & { organisation: OrganisationSnapshot };
  }

  async requirePermission(
    userId: string,
    permission: Permission,
    preferredBrandId?: string,
  ) {
    const ctx = await this.requireOrganisation(userId, preferredBrandId);
    const allowed =
      ctx.user.isPlatformAdmin ||
      (ctx.membership != null &&
        hasPermission(ctx.membership.role, permission, ctx.membership));
    if (!allowed) {
      throw new ForbiddenException('You do not have permission for this action.');
    }
    return ctx;
  }

  async requireBrandAccess(userId: string, brandId: string) {
    const ctx = await this.getContext(userId, brandId);
    if (ctx.user.isPlatformAdmin) {
      const brand = await this.prisma.brand.findUnique({
        where: { id: brandId },
        include: { wallet: true },
      });
      if (!brand) throw new NotFoundException('Brand not found.');
      return { ...ctx, activeBrandId: brand.id, activeBrand: this.presentBrand(brand) };
    }

    const inRoster = ctx.brands.some((brand) => brand.id === brandId);
    if (inRoster) {
      return {
        ...ctx,
        activeBrandId: brandId,
        activeBrand: ctx.brands.find((brand) => brand.id === brandId) ?? null,
      };
    }

    const scoped = await this.prisma.brandMembership.findUnique({
      where: { brandId_userId: { brandId, userId } },
      include: { brand: { include: { wallet: true } } },
    });
    if (!scoped) {
      throw new ForbiddenException('You cannot switch to that brand.');
    }

    const snapshot = this.presentBrand(scoped.brand);
    return {
      ...ctx,
      brands: ctx.brands.some((brand) => brand.id === snapshot.id)
        ? ctx.brands
        : [...ctx.brands, snapshot],
      activeBrandId: snapshot.id,
      activeBrand: snapshot,
    };
  }

  presentBrand(brand: BrandWithWallet): BrandSnapshot {
    return {
      id: brand.id,
      organisationId: brand.organisationId,
      name: brand.name,
      industry: brand.industry,
      country: brand.country,
      clientHasAccess: brand.clientHasAccess,
      wallet: brand.wallet
        ? { id: brand.wallet.id, currency: brand.wallet.currency }
        : null,
      createdAt: brand.createdAt,
    };
  }

  presentOrganisation(org: {
    id: string;
    type: OrganisationType;
    legalName: string;
    publicName: string;
    industry: string | null;
    website: string | null;
    country: string;
    verifiedAt: Date | null;
  }): OrganisationSnapshot {
    return {
      id: org.id,
      type: org.type,
      legalName: org.legalName,
      publicName: org.publicName,
      industry: org.industry,
      website: org.website,
      country: org.country,
      verifiedAt: org.verifiedAt,
    };
  }

  presentMembership(membership: {
    role: MembershipRole;
    canApprovePayments: boolean;
    canEditRates: boolean;
    canManageTeam: boolean;
    canExportData: boolean;
  }): MembershipSnapshot {
    return {
      role: membership.role,
      canApprovePayments: membership.canApprovePayments,
      canEditRates: membership.canEditRates,
      canManageTeam: membership.canManageTeam,
      canExportData: membership.canExportData,
      permissions: effectivePermissions(membership),
    };
  }

  private loadUser(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        creatorProfile: true,
        memberships: {
          include: {
            organisation: {
              include: {
                brands: { orderBy: { name: 'asc' }, include: { wallet: true } },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        brandMemberships: {
          include: { brand: { include: { wallet: true } } },
        },
      },
    });
  }
}
