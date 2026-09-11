import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { hasPermission } from '../common/permissions';
import { PrismaService } from '../prisma/prisma.service';

function jsonSafe(value: unknown): unknown {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object' && 'toNumber' in value) {
    const decimal = value as { toNumber?: () => number };
    if (typeof decimal.toNumber === 'function') return decimal.toNumber();
  }
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = jsonSafe(nested);
    }
    return out;
  }
  return value;
}

@Injectable()
export class DataExportService {
  constructor(private readonly prisma: PrismaService) {}

  async build(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        phone: true,
        phoneVerified: true,
        name: true,
        image: true,
        status: true,
        mfaEnabled: true,
        emailNotifications: true,
        weeklyDigest: true,
        createdAt: true,
        updatedAt: true,
        creatorProfile: {
          include: {
            portfolioItems: true,
            ratePackages: true,
            financialDocuments: true,
            payoutAccount: {
              select: {
                id: true,
                bankCode: true,
                bankName: true,
                accountName: true,
                accountNumberLast4: true,
                currency: true,
                verifiedAt: true,
                createdAt: true,
                updatedAt: true,
              },
            },
            socialAccounts: {
              select: {
                id: true,
                channel: true,
                externalId: true,
                handle: true,
                status: true,
                tokenExpiresAt: true,
                lastRefreshedAt: true,
                createdAt: true,
                updatedAt: true,
                snapshots: { orderBy: { capturedAt: 'desc' as const } },
              },
            },
            applications: {
              include: {
                brief: { select: { id: true, title: true, brandId: true } },
                offers: true,
              },
            },
            participants: {
              include: {
                campaign: { select: { id: true, title: true, brandId: true } },
                deliverables: { include: { submissions: true } },
                obligations: {
                  include: { transactions: true, disputes: true },
                },
              },
            },
          },
        },
        memberships: {
          select: {
            organisationId: true,
            role: true,
            canExportData: true,
          },
        },
      },
    });
    if (!user) throw new UnauthorizedException();
    if (user.status !== UserStatus.ACTIVE || !user.emailVerified) {
      throw new UnauthorizedException('Account is not active.');
    }

    const notifications = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    const exportableOrganisationIds = user.memberships
      .filter((membership) =>
        hasPermission(membership.role, 'data.export', membership),
      )
      .map((membership) => membership.organisationId);
    const organisations = exportableOrganisationIds.length
      ? await this.prisma.organisation.findMany({
          where: { id: { in: exportableOrganisationIds } },
          include: {
            brands: {
              include: {
                briefs: true,
                campaigns: {
                  include: {
                    participants: {
                      include: {
                        deliverables: { include: { submissions: true } },
                        obligations: {
                          include: { transactions: true, disputes: true },
                        },
                      },
                    },
                  },
                },
                wallet: true,
                financialDocuments: true,
              },
            },
            memberships: {
              select: {
                role: true,
                canApprovePayments: true,
                canEditRates: true,
                canManageTeam: true,
                canExportData: true,
                createdAt: true,
                user: { select: { id: true, name: true, email: true } },
              },
            },
          },
        })
      : [];

    return jsonSafe({
      exportVersion: 1,
      generatedAt: new Date().toISOString(),
      account: {
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        phone: user.phone,
        phoneVerified: user.phoneVerified,
        name: user.name,
        image: user.image,
        status: user.status,
        mfaEnabled: user.mfaEnabled,
        emailNotifications: user.emailNotifications,
        weeklyDigest: user.weeklyDigest,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      creatorProfile: user.creatorProfile,
      notifications,
      organisations,
    });
  }
}
