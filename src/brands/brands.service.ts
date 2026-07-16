import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Brand,
  BrandMember,
  BrandMemberRole,
  BrandServiceMode,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { slugify } from '../common/utils/string.util';
import {
  BrandMembershipResponseDto,
  OnboardBrandDto,
} from './dto/onboard-brand.dto';

@Injectable()
export class BrandsService {
  constructor(private readonly prisma: PrismaService) {}

  async onboard(
    userId: string,
    dto: OnboardBrandDto,
  ): Promise<BrandMembershipResponseDto> {
    if (dto.memberRole !== 'OWNER' && dto.memberRole !== 'AGENCY') {
      throw new BadRequestException(
        'memberRole must be OWNER (brand) or AGENCY',
      );
    }

    const baseSlug = slugify(dto.slug ?? dto.name);
    if (!baseSlug) {
      throw new BadRequestException('Could not derive a valid brand slug');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const brand = await this.createBrandWithUniqueSlug(tx, {
        name: dto.name,
        baseSlug,
        industry: dto.industry,
        billingEmail: dto.billingEmail,
        website: dto.website,
        serviceMode: dto.serviceMode ?? BrandServiceMode.MANAGED,
      });

      const member = await tx.brandMember.create({
        data: {
          brandId: brand.id,
          userId,
          role: dto.memberRole,
          acceptedAt: new Date(),
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: { intendedRole: null },
      });

      return { brand, member };
    });

    return this.toResponse(result.brand, result.member);
  }

  async me(userId: string): Promise<BrandMembershipResponseDto[]> {
    const memberships = await this.prisma.brandMember.findMany({
      where: { userId },
      include: { brand: true },
      orderBy: { invitedAt: 'asc' },
    });

    return memberships.map((m) => this.toResponse(m.brand, m));
  }

  async getMembership(
    userId: string,
    brandId: string,
  ): Promise<BrandMembershipResponseDto> {
    const membership = await this.prisma.brandMember.findUnique({
      where: { brandId_userId: { brandId, userId } },
      include: { brand: true },
    });
    if (!membership) {
      throw new NotFoundException('Brand membership not found');
    }
    return this.toResponse(membership.brand, membership);
  }

  private async createBrandWithUniqueSlug(
    tx: Prisma.TransactionClient,
    data: {
      name: string;
      baseSlug: string;
      industry: OnboardBrandDto['industry'];
      billingEmail: string;
      website?: string;
      serviceMode: BrandServiceMode;
    },
  ): Promise<Brand> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug =
        attempt === 0 ? data.baseSlug : `${data.baseSlug}-${attempt + 1}`;
      try {
        return await tx.brand.create({
          data: {
            name: data.name,
            slug,
            industry: data.industry,
            billingEmail: data.billingEmail,
            website: data.website,
            serviceMode: data.serviceMode,
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
    throw new ConflictException('Could not allocate a unique brand slug');
  }

  private toResponse(
    brand: Brand,
    member: BrandMember,
  ): BrandMembershipResponseDto {
    return {
      brandId: brand.id,
      name: brand.name,
      slug: brand.slug,
      industry: brand.industry,
      status: brand.status,
      serviceMode: brand.serviceMode,
      role: member.role,
      billingEmail: brand.billingEmail,
      website: brand.website,
      createdAt: brand.createdAt,
    };
  }
}
