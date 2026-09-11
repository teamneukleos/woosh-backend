import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import {
  inAppNotificationMessage,
  weeklyDigestMessage,
} from '../mail/templates';
import { PrismaService } from '../prisma/prisma.service';
import { utcWeekStart } from './week';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  list(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  unreadCount(userId: string) {
    return this.prisma.notification.count({
      where: { userId, readAt: null },
    });
  }

  markRead(userId: string, ids?: string[]) {
    return this.prisma.notification.updateMany({
      where: {
        userId,
        readAt: null,
        ...(ids?.length ? { id: { in: ids } } : {}),
      },
      data: { readAt: new Date() },
    });
  }

  async create(input: {
    userId: string;
    type: string;
    title: string;
    body: string;
    href?: string;
    dedupeKey?: string;
  }) {
    if (input.dedupeKey) {
      const existing = await this.prisma.notification.findUnique({
        where: { dedupeKey: input.dedupeKey },
      });
      if (existing) return existing;
    }

    let notification;
    try {
      notification = await this.prisma.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          href: input.href,
          dedupeKey: input.dedupeKey,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        input.dedupeKey
      ) {
        return this.prisma.notification.findUniqueOrThrow({
          where: { dedupeKey: input.dedupeKey },
        });
      }
      throw error;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { email: true, emailNotifications: true },
    });
    if (user?.email && user.emailNotifications !== false) {
      const href = this.mail.frontendUrl(input.href || '/app/notifications');
      const message = inAppNotificationMessage({
        title: input.title,
        body: input.body,
        href,
      });
      await this.mail.sendBestEffort({ ...message, to: user.email });
    }
    return notification;
  }

  async sendWeeklyDigests(now = new Date()) {
    const currentWeekStart = utcWeekStart(now);
    const previousWeekStart = new Date(
      currentWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000,
    );
    const weekKey = currentWeekStart.toISOString().slice(0, 10);
    const users = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        emailNotifications: true,
        weeklyDigest: true,
      },
      select: { id: true, email: true, name: true },
      take: 1_000,
    });
    const result = { eligible: users.length, sent: 0, skipped: 0, failed: 0 };

    for (const user of users) {
      const auditTarget = `${user.id}:${weekKey}`;
      const alreadySent = await this.prisma.auditEvent.findFirst({
        where: {
          action: 'notification.weekly_digest.sent',
          targetType: 'UserWeeklyDigest',
          targetId: auditTarget,
        },
        select: { id: true },
      });
      if (alreadySent) {
        result.skipped += 1;
        continue;
      }
      const notifications = await this.prisma.notification.findMany({
        where: {
          userId: user.id,
          createdAt: { gte: previousWeekStart, lt: currentWeekStart },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      if (!notifications.length) {
        result.skipped += 1;
        continue;
      }
      try {
        const message = weeklyDigestMessage({
          name: user.name,
          href: this.mail.frontendUrl('/app/notifications'),
          items: notifications.map((row) => ({
            title: row.title,
            body: row.body,
          })),
        });
        await this.mail.send({ ...message, to: user.email });
        await this.prisma.auditEvent.create({
          data: {
            actorId: user.id,
            action: 'notification.weekly_digest.sent',
            targetType: 'UserWeeklyDigest',
            targetId: auditTarget,
            metadata: { notificationCount: notifications.length },
          },
        });
        result.sent += 1;
      } catch (error) {
        this.logger.error(
          `Weekly digest failed for ${user.email}`,
          error instanceof Error ? error.stack : error,
        );
        result.failed += 1;
      }
    }
    return result;
  }
}
