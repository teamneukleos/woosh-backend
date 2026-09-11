import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ProspectStatus, UserStatus } from '@prisma/client';
import { hash } from 'bcryptjs';
import { hashToken } from '../common/crypto/tokens';
import { PrismaService } from '../prisma/prisma.service';
import type { ClaimRegisterDto } from './dto/claim-register.dto';
import { normalizeHandle } from './handle';

@Injectable()
export class ClaimService {
  constructor(private readonly prisma: PrismaService) {}

  async getByToken(rawToken: string) {
    const interest = await this.findInterest(rawToken);
    if (!interest) return null;
    return this.presentClaim(interest);
  }

  async registerAndClaim(rawToken: string, input: ClaimRegisterDto) {
    return this.claim(rawToken, { register: input });
  }

  async accept(rawToken: string, userId: string) {
    return this.claim(rawToken, { userId });
  }

  private async claim(
    rawToken: string,
    input: { userId?: string; register?: ClaimRegisterDto },
  ) {
    const interest = await this.findInterest(rawToken);
    if (!interest) throw new BadRequestException('Invite not found.');
    if (interest.claimTokenExpiresAt < new Date()) {
      throw new BadRequestException('Invite has expired.');
    }
    if (interest.status === 'CLAIMED' || interest.status === 'CLOSED') {
      throw new BadRequestException('Invite is no longer available.');
    }
    if (!interest.prospectId || !interest.prospect) {
      throw new BadRequestException('This invite is not for an unclaimed prospect.');
    }

    const prospect = interest.prospect;
    let userId = input.userId;

    if (!userId) {
      if (!input.register) {
        throw new BadRequestException('Registration details required.');
      }
      const email = input.register.email.toLowerCase().trim();
      const invitedEmail = prospect.contactEmail?.trim().toLowerCase();
      if (invitedEmail && invitedEmail !== email) {
        throw new BadRequestException(
          'Use the email address that received this claim invite.',
        );
      }
      const existing = await this.prisma.user.findUnique({ where: { email } });
      if (existing) {
        throw new ConflictException(
          'Account exists — sign in, then accept this claim.',
        );
      }
      const passwordHash = await hash(input.register.password, 12);
      const verified = Boolean(invitedEmail);
      const user = await this.prisma.user.create({
        data: {
          email,
          name: input.register.name.trim(),
          passwordHash,
          status: verified ? UserStatus.ACTIVE : UserStatus.PENDING_VERIFICATION,
          emailVerified: verified ? new Date() : null,
          creatorProfile: {
            create: {
              displayName: prospect.displayName || input.register.name.trim(),
              locationCountry: prospect.locationCountry,
              locationCity: prospect.locationCity,
              categories: prospect.categories,
            },
          },
        },
      });
      userId = user.id;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { creatorProfile: true },
    });
    if (!user) throw new UnauthorizedException();

    let profile = user.creatorProfile;
    if (!profile) {
      profile = await this.prisma.creatorProfile.create({
        data: {
          userId: user.id,
          displayName: prospect.displayName || user.name || 'Creator',
          locationCountry: prospect.locationCountry,
          locationCity: prospect.locationCity,
          categories: prospect.categories,
        },
      });
    }

    const handle = normalizeHandle(prospect.handle);
    await this.prisma.socialAccount.upsert({
      where: {
        channel_externalId: { channel: prospect.channel, externalId: handle },
      },
      create: {
        creatorProfileId: profile.id,
        channel: prospect.channel,
        externalId: handle,
        handle,
        status: 'PENDING',
      },
      update: {
        creatorProfileId: profile.id,
        handle,
        status: 'PENDING',
      },
    });

    await this.prisma.$transaction([
      this.prisma.creatorProspect.update({
        where: { id: prospect.id },
        data: {
          status: ProspectStatus.CLAIMED,
          claimedProfileId: profile.id,
        },
      }),
      this.prisma.brandInterest.update({
        where: { id: interest.id },
        data: {
          status: 'CLAIMED',
          creatorProfileId: profile.id,
        },
      }),
    ]);

    const conversation = await this.prisma.conversation.create({
      data: {
        type: 'SUPPORT',
        brandId: interest.brandId,
        creatorProfileId: profile.id,
        messages: {
          create: {
            isSystem: true,
            body: `${profile.displayName} claimed @${prospect.handle} after interest from ${interest.brand.name}.`,
          },
        },
      },
    });
    await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderUserId: interest.createdById,
        body:
          interest.message ||
          `Hi ${profile.displayName} — thanks for joining Woosh. Let's talk.`,
      },
    });
    await this.prisma.notification.create({
      data: {
        userId: interest.createdById,
        type: 'prospect.claimed',
        title: `@${prospect.handle} claimed their profile`,
        body: `${profile.displayName} is now on Woosh and ready to message.`,
        href: '/app/messages',
      },
    });
    await this.prisma.notification.create({
      data: {
        userId: user.id,
        type: 'claim.complete',
        title: 'Welcome to Woosh',
        body: `You claimed @${prospect.handle}. ${interest.brand.name} is waiting to chat.`,
        href: '/app/messages',
      },
    });
    await this.prisma.auditEvent.create({
      data: {
        actorId: user.id,
        action: 'prospect.claim',
        targetType: 'CreatorProspect',
        targetId: prospect.id,
        after: { creatorProfileId: profile.id, brandInterestId: interest.id },
      },
    });

    return {
      ok: true,
      creatorProfileId: profile.id,
      conversationId: conversation.id,
      emailVerified: Boolean(user.emailVerified),
      message: user.emailVerified
        ? 'Profile claimed. Sign in to continue.'
        : 'Profile claimed. Verify your email before signing in.',
    };
  }

  private findInterest(rawToken: string) {
    return this.prisma.brandInterest.findUnique({
      where: { claimToken: hashToken(rawToken) },
      include: {
        brand: { select: { id: true, name: true } },
        prospect: true,
        creatorProfile: { select: { id: true, displayName: true } },
      },
    });
  }

  private presentClaim(
    interest: NonNullable<Awaited<ReturnType<ClaimService['findInterest']>>>,
  ) {
    const expired = interest.claimTokenExpiresAt < new Date();
    const claimed = interest.status === 'CLAIMED';
    return {
      brand: interest.brand,
      prospect: interest.prospect
        ? {
            id: interest.prospect.id,
            channel: interest.prospect.channel,
            handle: interest.prospect.handle,
            displayName: interest.prospect.displayName,
            status: interest.prospect.status,
          }
        : null,
      creatorProfile: interest.creatorProfile,
      status: interest.status,
      expiresAt: interest.claimTokenExpiresAt,
      expired,
      claimed,
      available: !expired && !claimed && interest.status !== 'CLOSED',
    };
  }
}
