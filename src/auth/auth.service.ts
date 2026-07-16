import { createHash, randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import {
  AuthResponseDto,
  MeResponseDto,
  UserResponseDto,
} from './dto/auth-response.dto';
import { MessageResponseDto } from './dto/message-response.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
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

  async forgotPassword(dto: ForgotPasswordDto): Promise<MessageResponseDto> {
    const generic: MessageResponseDto = {
      message:
        'If that email exists, we sent a password reset link. Check your inbox.',
    };

    const user = await this.prisma.user.findFirst({
      where: {
        email: dto.email,
        deletedAt: null,
        status: { not: UserStatus.SUSPENDED },
      },
    });

    // Always return the same message (don't leak whether the email exists)
    if (!user?.passwordHash) {
      return generic;
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresMinutes = Number(
      this.config.get<string>('PASSWORD_RESET_EXPIRES_MINUTES') ?? '30',
    );
    const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);

    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      }),
    ]);

    const frontendUrl = (
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173'
    ).replace(/\/$/, '');
    const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;

    try {
      await this.email.sendPasswordResetEmail({
        to: user.email,
        firstName: user.firstName,
        resetUrl,
      });
    } catch (error) {
      this.logger.error('Password reset email failed', error);
      // Still return generic message — don't leak delivery failures to callers
    }

    return generic;
  }

  async resetPassword(dto: ResetPasswordDto): Promise<MessageResponseDto> {
    const tokenHash = this.hashToken(dto.token);
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (
      !record ||
      record.usedAt ||
      record.expiresAt.getTime() < Date.now() ||
      record.user.deletedAt ||
      record.user.status === UserStatus.SUSPENDED
    ) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);

    return { message: 'Password updated successfully. You can log in now.' };
  }

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
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
