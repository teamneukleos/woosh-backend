import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContentLanguage, Creator, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { generateReferralCode } from '../common/utils/string.util';
import {
  CreatorResponseDto,
  OnboardCreatorDto,
} from './dto/onboard-creator.dto';

@Injectable()
export class CreatorsService {
  constructor(private readonly prisma: PrismaService) {}

  async onboard(
    userId: string,
    dto: OnboardCreatorDto,
  ): Promise<CreatorResponseDto> {
    const existing = await this.prisma.creator.findUnique({
      where: { userId },
    });
    if (existing) {
      throw new ConflictException('User already has a creator profile');
    }

    let referredById: string | undefined;
    if (dto.referredByCode) {
      const referrer = await this.prisma.creator.findUnique({
        where: { referralCode: dto.referredByCode },
      });
      if (!referrer) {
        throw new NotFoundException('Referral code not found');
      }
      referredById = referrer.id;
    }

    const languages = Array.from(
      new Set([
        dto.primaryLanguage ?? ContentLanguage.EN,
        ...(dto.languages ?? []),
      ]),
    );

    const creator = await this.prisma.$transaction(async (tx) => {
      const created = await this.createCreatorWithUniqueCode(tx, {
        userId,
        displayName: dto.displayName,
        bio: dto.bio,
        locationState: dto.locationState,
        locationCity: dto.locationCity,
        tier: dto.tier,
        primaryLanguage: dto.primaryLanguage ?? ContentLanguage.EN,
        referredById,
      });

      if (languages.length) {
        await tx.creatorLanguage.createMany({
          data: languages.map((language) => ({
            creatorId: created.id,
            language,
          })),
        });
      }

      await tx.creatorWallet.create({
        data: { creatorId: created.id },
      });

      await tx.user.update({
        where: { id: userId },
        data: { intendedRole: null },
      });

      return created;
    });

    return this.toResponse(creator, languages);
  }

  async me(userId: string): Promise<CreatorResponseDto> {
    const creator = await this.prisma.creator.findUnique({
      where: { userId },
      include: { languages: true },
    });
    if (!creator) {
      throw new NotFoundException('Creator profile not found');
    }
    return this.toResponse(
      creator,
      creator.languages.map((l) => l.language),
    );
  }

  private async createCreatorWithUniqueCode(
    tx: Prisma.TransactionClient,
    data: {
      userId: string;
      displayName: string;
      bio?: string;
      locationState: string;
      locationCity?: string;
      tier?: OnboardCreatorDto['tier'];
      primaryLanguage: ContentLanguage;
      referredById?: string;
    },
  ): Promise<Creator> {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await tx.creator.create({
          data: {
            userId: data.userId,
            displayName: data.displayName,
            bio: data.bio,
            locationState: data.locationState,
            locationCity: data.locationCity,
            tier: data.tier,
            primaryLanguage: data.primaryLanguage,
            referralCode: generateReferralCode(),
            referredById: data.referredById,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException('Could not allocate a unique referral code');
  }

  private toResponse(
    creator: Creator,
    languages: ContentLanguage[],
  ): CreatorResponseDto {
    return {
      id: creator.id,
      userId: creator.userId,
      displayName: creator.displayName,
      bio: creator.bio,
      locationState: creator.locationState,
      locationCity: creator.locationCity,
      tier: creator.tier,
      primaryLanguage: creator.primaryLanguage,
      verificationStatus: creator.verificationStatus,
      referralCode: creator.referralCode,
      languages,
      createdAt: creator.createdAt,
    };
  }
}
