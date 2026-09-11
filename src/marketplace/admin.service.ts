import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BriefStatus } from '@prisma/client';
import { SupplyService } from '../creator/supply.service';
import { WorkspaceService } from '../organisation/workspace.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateProspectDto } from '../creator/dto/create-prospect.dto';

@Injectable()
export class AdminOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
    private readonly supply: SupplyService,
  ) {}

  async listPendingBriefs(adminId: string) {
    await this.workspace.requirePlatformAdmin(adminId);
    const rows = await this.prisma.brief.findMany({
      where: { status: BriefStatus.PENDING_MODERATION },
      include: {
        brand: {
          select: {
            name: true,
            organisation: { select: { publicName: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return rows.map((brief) => ({
      id: brief.id,
      title: brief.title,
      status: brief.status,
      brand: brief.brand,
    }));
  }

  async listOrganisations(adminId: string) {
    await this.workspace.requirePlatformAdmin(adminId);
    return this.prisma.organisation.findMany({
      select: {
        id: true,
        publicName: true,
        type: true,
        verifiedAt: true,
        brands: { select: { id: true, name: true }, orderBy: { name: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async listUsers(adminId: string) {
    await this.workspace.requirePlatformAdmin(adminId);
    return this.prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        isPlatformAdmin: true,
        creatorProfile: { select: { displayName: true } },
        memberships: {
          select: { organisation: { select: { type: true } } },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async prospectCount(adminId: string) {
    await this.workspace.requirePlatformAdmin(adminId);
    const count = await this.prisma.creatorProspect.count();
    return { count };
  }

  async verifyOrganisation(
    adminId: string,
    organisationId: string,
    verified: boolean,
  ) {
    await this.workspace.requirePlatformAdmin(adminId);
    const organisation = await this.prisma.organisation.findUnique({
      where: { id: organisationId },
      select: { id: true, verifiedAt: true },
    });
    if (!organisation) throw new NotFoundException('Organisation not found.');
    const updated = await this.prisma.organisation.update({
      where: { id: organisationId },
      data: { verifiedAt: verified ? new Date() : null },
      select: {
        id: true,
        publicName: true,
        type: true,
        verifiedAt: true,
      },
    });
    await this.prisma.auditEvent.create({
      data: {
        actorId: adminId,
        action: verified ? 'organisation.verify' : 'organisation.unverify',
        targetType: 'Organisation',
        targetId: organisationId,
        before: { verifiedAt: organisation.verifiedAt },
        after: { verifiedAt: updated.verifiedAt },
      },
    });
    return updated;
  }

  async setUserAdmin(adminId: string, userId: string, isAdmin: boolean) {
    await this.workspace.requirePlatformAdmin(adminId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isPlatformAdmin: true },
    });
    if (!user) throw new NotFoundException('User not found.');
    if (!isAdmin) {
      const remaining = await this.prisma.user.count({
        where: { isPlatformAdmin: true, NOT: { id: userId } },
      });
      if (remaining === 0) {
        throw new BadRequestException('Cannot revoke the last platform admin.');
      }
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { isPlatformAdmin: isAdmin },
      select: { id: true, email: true, isPlatformAdmin: true },
    });
    await this.prisma.auditEvent.create({
      data: {
        actorId: adminId,
        action: isAdmin ? 'user.admin.grant' : 'user.admin.revoke',
        targetType: 'User',
        targetId: userId,
        after: { isPlatformAdmin: isAdmin },
      },
    });
    return updated;
  }

  async seedProspects(adminId: string, rows: CreateProspectDto[]) {
    await this.workspace.requirePlatformAdmin(adminId);
    let upserted = 0;
    let skipped = 0;
    for (const row of rows) {
      if (!row.handle?.trim()) {
        skipped += 1;
        continue;
      }
      await this.supply.createProspect(adminId, {
        ...row,
        locationCountry: row.locationCountry || 'NG',
      });
      upserted += 1;
    }
    return { upserted, skipped };
  }
}
