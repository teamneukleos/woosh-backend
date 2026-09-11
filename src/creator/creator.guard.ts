import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

export type CreatorRequest = {
  user: AuthUser;
  creatorProfileId?: string;
};

@Injectable()
export class CreatorGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CreatorRequest>();
    const userId = request.user?.id;
    if (!userId) return false;
    const profile = await this.prisma.creatorProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) {
      throw new ForbiddenException('Creator workspace required.');
    }
    request.creatorProfileId = profile.id;
    return true;
  }
}
