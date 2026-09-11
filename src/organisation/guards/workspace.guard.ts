import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import type { Permission } from '../../common/permissions';
import {
  ORG_PERMISSION_KEY,
  ORG_REQUIRED_KEY,
} from '../decorators/require-permission.decorator';
import type { AuthedRequest } from '../decorators/current-workspace.decorator';
import { WorkspaceService } from '../workspace.service';

@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly workspace: WorkspaceService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(
      ORG_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    const orgRequired = this.reflector.getAllAndOverride<boolean>(
      ORG_REQUIRED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!permission && !orgRequired) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const user = request.user as AuthUser | undefined;
    if (!user?.id) return false;

    const preferredBrandId = this.readPreferredBrandId(context);
    request.workspace = permission
      ? await this.workspace.requirePermission(user.id, permission, preferredBrandId)
      : await this.workspace.requireOrganisation(user.id, preferredBrandId);
    return true;
  }

  private readPreferredBrandId(context: ExecutionContext): string | undefined {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      query: Record<string, string | string[] | undefined>;
      body?: { brandId?: string };
    }>();
    const header = request.headers['x-brand-id'];
    const fromHeader = Array.isArray(header) ? header[0] : header;
    const query = request.query.brandId;
    const fromQuery = Array.isArray(query) ? query[0] : query;
    return fromHeader || fromQuery || request.body?.brandId || undefined;
  }
}
