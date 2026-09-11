import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OrganisationType, UserStatus } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { hashToken, newOpaqueToken } from '../common/crypto/tokens';
import { seatFor } from '../common/seat';
import { MailService } from '../mail/mail.service';
import { resetPasswordMessage, verifyEmailMessage } from '../mail/templates';
import { PrismaService } from '../prisma/prisma.service';
import type { AccountType } from './dto/register.dto';

const ACCESS_EXPIRES = '15m';
const REFRESH_DAYS = 7;
const VERIFY_HOURS = 24;
const RESET_HOURS = 1;
const GENERIC_EMAIL_MESSAGE =
  'If that email is registered, we sent a message.';

@Injectable()
export class IdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  async register(input: {
    name: string;
    email: string;
    password: string;
    accountType?: AccountType;
    inviteToken?: string;
  }) {
    const email = input.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with that email already exists.');
    }

    const inviteToken = input.inviteToken?.trim();
    const pendingInvite = inviteToken
      ? await this.prisma.teamInvite.findUnique({
          where: { token: hashToken(inviteToken) },
        })
      : null;
    if (inviteToken) {
      if (!pendingInvite || pendingInvite.expiresAt < new Date()) {
        throw new BadRequestException('Invite not found or expired.');
      }
      if (pendingInvite.acceptedAt) {
        throw new ConflictException('This invite has already been accepted.');
      }
      if (pendingInvite.email.toLowerCase() !== email) {
        throw new BadRequestException('Use the email this invite was sent to.');
      }
    } else if (!input.accountType) {
      throw new BadRequestException('Account type is required.');
    }

    const passwordHash = await hash(input.password, 12);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          name: input.name.trim(),
          passwordHash,
          status: pendingInvite
            ? UserStatus.ACTIVE
            : UserStatus.PENDING_VERIFICATION,
          emailVerified: pendingInvite ? new Date() : null,
        },
      });

      if (pendingInvite) {
        await tx.membership.create({
          data: {
            organisationId: pendingInvite.organisationId,
            userId: created.id,
            role: pendingInvite.role,
          },
        });
        await tx.teamInvite.update({
          where: { id: pendingInvite.id },
          data: { acceptedAt: new Date() },
        });
      } else if (input.accountType === 'creator') {
        await tx.creatorProfile.create({
          data: {
            userId: created.id,
            displayName: input.name.trim(),
          },
        });
      } else {
        const org = await tx.organisation.create({
          data: {
            type:
              input.accountType === 'agency'
                ? OrganisationType.AGENCY
                : OrganisationType.BRAND,
            legalName: input.name.trim(),
            publicName: input.name.trim(),
            country: 'NG',
          },
        });

        await tx.membership.create({
          data: {
            organisationId: org.id,
            userId: created.id,
            role: 'OWNER',
            canApprovePayments: true,
            canEditRates: true,
            canManageTeam: true,
            canExportData: true,
          },
        });

        if (input.accountType === 'brand') {
          const brand = await tx.brand.create({
            data: {
              organisationId: org.id,
              name: input.name.trim(),
              country: 'NG',
            },
          });
          await tx.brandMembership.create({
            data: {
              brandId: brand.id,
              userId: created.id,
              role: 'OWNER',
            },
          });
          await tx.brandWallet.create({
            data: {
              brandId: brand.id,
              currency: 'NGN',
            },
          });
        }
      }

      await tx.auditEvent.create({
        data: {
          actorId: created.id,
          action: 'user.register',
          targetType: 'User',
          targetId: created.id,
          metadata: pendingInvite
            ? {
                via: 'team_invite',
                organisationId: pendingInvite.organisationId,
                role: pendingInvite.role,
              }
            : { accountType: input.accountType },
        },
      });

      return created;
    });

    if (!pendingInvite) {
      await this.issueEmailVerification(user.id, user.email);
    }

    return {
      ok: true,
      emailVerified: Boolean(pendingInvite),
      message: pendingInvite
        ? 'Account created. You can sign in now.'
        : 'Account created. Verify your email before signing in.',
    };
  }

  async login(input: { email: string; password: string }) {
    const email = input.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    if (user.status !== UserStatus.ACTIVE || !user.emailVerified) {
      throw new UnauthorizedException(
        'Verify your email before signing in.',
      );
    }

    const valid = await compare(input.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    return this.issueSession(user.id, user.email);
  }

  async refresh(rawRefreshToken: string) {
    const tokenHash = hashToken(rawRefreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (
      !stored ||
      stored.revokedAt ||
      stored.expiresAt < new Date() ||
      stored.user.status !== UserStatus.ACTIVE
    ) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueSession(stored.user.id, stored.user.email);
  }

  async logout(rawRefreshToken: string) {
    const tokenHash = hashToken(rawRefreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  async verifyEmail(rawToken: string) {
    const tokenHash = hashToken(rawToken);
    const stored = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
    });
    if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('That verification link is invalid or expired.');
    }

    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({
        where: { id: stored.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: stored.userId },
        data: {
          emailVerified: new Date(),
          status: UserStatus.ACTIVE,
        },
      }),
    ]);

    return { ok: true, message: 'Email verified. You can now sign in.' };
  }

  async resendVerification(emailRaw: string) {
    const email = emailRaw.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (
      user &&
      user.status === UserStatus.PENDING_VERIFICATION &&
      !user.emailVerified
    ) {
      await this.issueEmailVerification(user.id, user.email);
    }
    return { ok: true, message: GENERIC_EMAIL_MESSAGE };
  }

  async forgotPassword(emailRaw: string) {
    const email = emailRaw.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user?.passwordHash) {
      const raw = newOpaqueToken();
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + RESET_HOURS);
      await this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(raw),
          expiresAt,
        },
      });
      const message = resetPasswordMessage(
        this.mail.frontendUrl(
          `/login?reset=${raw}&email=${encodeURIComponent(email)}`,
        ),
      );
      await this.mail.sendBestEffort({ ...message, to: email });
    }
    return { ok: true, message: GENERIC_EMAIL_MESSAGE };
  }

  async resetPassword(input: { email: string; token: string; password: string }) {
    const email = input.email.toLowerCase().trim();
    const tokenHash = hashToken(input.token);
    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (
      !stored ||
      stored.usedAt ||
      stored.expiresAt < new Date() ||
      stored.user.email !== email
    ) {
      throw new UnauthorizedException('That reset link is invalid or expired.');
    }

    const passwordHash = await hash(input.password, 12);
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({
        where: { id: stored.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: stored.userId },
        data: { passwordHash },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { ok: true, message: 'Password updated. Sign in with your new password.' };
  }

  async changePassword(userId: string, input: { currentPassword: string; newPassword: string }) {
    if (input.currentPassword === input.newPassword) {
      throw new BadRequestException('Choose a password you have not already used here.');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user?.passwordHash) {
      throw new BadRequestException('Password sign-in is unavailable.');
    }
    if (!(await compare(input.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect.');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hash(input.newPassword, 12) },
    });
    await this.prisma.auditEvent.create({
      data: {
        actorId: userId,
        action: 'user.password.change',
        targetType: 'User',
        targetId: userId,
      },
    });
    return { ok: true };
  }

  async updateNotificationPreferences(
    userId: string,
    input: { emailNotifications: boolean; weeklyDigest: boolean },
  ) {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        emailNotifications: input.emailNotifications,
        weeklyDigest: input.emailNotifications && input.weeklyDigest,
      },
      select: { emailNotifications: true, weeklyDigest: true },
    });
    await this.prisma.auditEvent.create({
      data: {
        actorId: userId,
        action: 'user.notification_preferences.update',
        targetType: 'User',
        targetId: userId,
        after: updated,
      },
    });
    return updated;
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        creatorProfile: true,
        memberships: {
          include: {
            organisation: {
              include: { brands: { orderBy: { name: 'asc' } } },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        brandMemberships: { include: { brand: true } },
      },
    });
    if (!user) throw new UnauthorizedException();

    const membership = user.memberships[0] ?? null;
    const organisation = membership?.organisation ?? null;
    const brands = organisation?.brands ?? user.brandMemberships.map((m) => m.brand);
    const seat = seatFor({
      isPlatformAdmin: user.isPlatformAdmin,
      hasCreatorProfile: Boolean(user.creatorProfile),
      organisationType: organisation?.type ?? null,
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      status: user.status,
      emailVerified: user.emailVerified,
      emailNotifications: user.emailNotifications,
      weeklyDigest: user.weeklyDigest,
      isPlatformAdmin: user.isPlatformAdmin,
      seat,
      creatorProfile: user.creatorProfile
        ? {
            id: user.creatorProfile.id,
            displayName: user.creatorProfile.displayName,
            marketplaceStatus: user.creatorProfile.marketplaceStatus,
          }
        : null,
      organisation: organisation
        ? {
            id: organisation.id,
            type: organisation.type,
            publicName: organisation.publicName,
            verifiedAt: organisation.verifiedAt,
            role: membership?.role ?? null,
          }
        : null,
      brands: brands.map((brand) => ({
        id: brand.id,
        name: brand.name,
        organisationId: brand.organisationId,
      })),
    };
  }

  private async issueSession(userId: string, email: string) {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, email },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: ACCESS_EXPIRES,
      },
    );

    const rawRefresh = newOpaqueToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_DAYS);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(rawRefresh),
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken: rawRefresh,
      tokenType: 'Bearer',
      expiresIn: 15 * 60,
    };
  }

  private async issueEmailVerification(userId: string, email: string) {
    const raw = newOpaqueToken();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + VERIFY_HOURS);
    await this.prisma.emailVerificationToken.create({
      data: {
        userId,
        tokenHash: hashToken(raw),
        expiresAt,
      },
    });
    const message = verifyEmailMessage(
      this.mail.frontendUrl(
        `/api/auth/verify-email?token=${raw}&email=${encodeURIComponent(email)}`,
      ),
    );
    await this.mail.sendBestEffort({ ...message, to: email });
  }
}
