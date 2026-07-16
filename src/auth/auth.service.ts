import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import {
  AuthResponseDto,
  MeResponseDto,
  UserResponseDto,
} from './dto/auth-response.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        passwordHash,
        intendedRole: dto.intendedRole,
        status: UserStatus.ACTIVE,
      },
    });

    return this.toAuthResponse(user);
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user?.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status === UserStatus.SUSPENDED || user.deletedAt) {
      throw new UnauthorizedException('Account is not available');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.toAuthResponse(user);
  }

  async me(userId: string): Promise<MeResponseDto> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        creator: true,
        brandMemberships: {
          include: { brand: true },
          orderBy: { invitedAt: 'asc' },
        },
      },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const isCreator = Boolean(user.creator);
    const brands = user.brandMemberships.map((m) => ({
      brandId: m.brandId,
      name: m.brand.name,
      role: m.role,
    }));

    return {
      ...this.toUserResponse(user),
      isCreator,
      creatorId: user.creator?.id ?? null,
      brands,
      needsOnboarding: !isCreator && brands.length === 0,
    };
  }

  private toAuthResponse(user: User): AuthResponseDto {
    return {
      accessToken: this.jwt.sign({ sub: user.id, email: user.email }),
      user: this.toUserResponse(user),
    };
  }

  private toUserResponse(user: User): UserResponseDto {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      intendedRole: user.intendedRole,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
    };
  }
}
