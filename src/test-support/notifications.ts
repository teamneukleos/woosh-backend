import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import type { MailPayload } from '../mail/templates';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

/** MailService that records instead of calling Resend. `fail` makes every send throw. */
export class RecordingMail extends MailService {
  sent: MailPayload[] = [];
  fail = false;

  constructor(frontendUrl = 'https://app.woosh.test') {
    super({
      get: (key: string) => (key === 'FRONTEND_URL' ? frontendUrl : undefined),
    } as ConfigService);
  }

  override send(payload: MailPayload) {
    if (this.fail) return Promise.reject(new Error('Resend is down'));
    this.sent.push(payload);
    return Promise.resolve({
      id: `test-${this.sent.length}`,
      provider: 'resend' as const,
    });
  }
}

export function testNotifications(
  prisma: PrismaService,
  mail = new RecordingMail(),
) {
  return new NotificationsService(prisma, mail);
}
