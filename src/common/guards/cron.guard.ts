import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

@Injectable()
export class CronGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.WOOSH_CRON_SECRET?.trim();
    if (!expected) {
      throw new ServiceUnavailableException('Cron secret is not configured');
    }
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
    }>();
    const provided = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(provided);
    if (
      !provided ||
      expectedBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(expectedBuffer, providedBuffer)
    ) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
