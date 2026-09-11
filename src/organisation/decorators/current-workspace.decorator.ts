import { createParamDecorator, ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import type { WorkspaceSnapshot } from '../workspace.types';

export type AuthedRequest = {
  user: AuthUser;
  workspace?: WorkspaceSnapshot;
};

export const CurrentWorkspace = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): WorkspaceSnapshot => {
    const request = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!request.workspace?.organisation) {
      throw new ForbiddenException('Organisation workspace required.');
    }
    return request.workspace;
  },
);
