import { createParamDecorator, ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { CreatorRequest } from './creator.guard';

export const CurrentCreatorId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<CreatorRequest>();
    if (!request.creatorProfileId) {
      throw new ForbiddenException('Creator workspace required.');
    }
    return request.creatorProfileId;
  },
);
