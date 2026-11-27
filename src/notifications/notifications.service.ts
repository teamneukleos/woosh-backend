import { Injectable, Logger } from '@nestjs/common';
import { Notification, Prisma, UserStatus } from '@prisma/client';
import {
  hasOrgWideBrandAccess,
  hasPermission,
  type Permission,
} from '../common/permissions';
import { MailService } from '../mail/mail.service';
import {
  inAppNotificationMessage,
  weeklyDigestMessage,
} from '../mail/templates';
import { PrismaService } from '../prisma/prisma.service';
import { emailCtaLabel, emailsByDefault } from './email-policy';
import { utcWeekStart } from './week';

const MESSAGE_QUIET_MS = 12 * 60 * 60 * 1000;

export type NotificationInput = {
  userId: string;
  type: string;
  title: string;
  body: string;
  href?: string;
  dedupeKey?: string;
  /** Override the email policy for this one notification. */
  email?: boolean;
};

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

  /**
   * The one place that records an in-app notification and decides whether it is also
   * emailed. Call it only after the product action's transaction has committed.
   *
   * - Email goes out only for types in EMAIL_NOTIFICATION_TYPES (or `email: true`), to an
   *   ACTIVE user whose `emailNotifications` preference is on.
   * - With a `dedupeKey`, only the call that actually inserts the row sends the email, so
   *   retries and concurrent duplicates never email twice.
   * - Email failures are logged and never thrown back to the product action.
   */
  async create(input: NotificationInput) {
    if (input.dedupeKey) {
      const existing = await this.prisma.notification.findUnique({
        where: { dedupeKey: input.dedupeKey },
      });
      if (existing) return existing;
    }

    let notification: Notification;
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

    if (input.email ?? emailsByDefault(input.type)) {
      await this.emailNotification(input);
    }
    return notification;
  }

  /** Same notification for several users; each gets its own dedupe key and email. */
  async createForUsers(
    userIds: Iterable<string>,
    input: Omit<NotificationInput, 'userId' | 'dedupeKey'> & { dedupePrefix?: string },
  ) {
    const { dedupePrefix, ...rest } = input;
    for (const userId of new Set(userIds)) {
      await this.create({
        ...rest,
        userId,
        dedupeKey: dedupePrefix ? `${dedupePrefix}:${userId}` : undefined,
      });
    }
  }

  /**
   * Users who can see this brand: its brand-scoped members, plus org owners/admins (who
   * see every brand). Other org members are deliberately excluded: an agency teammate
   * scoped to one brand must not hear about another brand's work or money.
   */
  async brandRecipients(brandId: string, permission?: Permission) {
    const brand = await this.prisma.brand.findUnique({
      where: { id: brandId },
      select: {
        memberships: { select: { userId: true, role: true } },
        organisation: {
          select: {
            memberships: {
              select: {
                userId: true,
                role: true,
                canApprovePayments: true,
                canEditRates: true,
                canManageTeam: true,
                canExportData: true,
              },
            },
          },
        },
      },
    });
    if (!brand) return [];
    const ids = new Set<string>();
    for (const member of brand.memberships) {
      if (!permission || hasPermission(member.role, permission)) ids.add(member.userId);
    }
    for (const member of brand.organisation.memberships) {
      if (!hasOrgWideBrandAccess(member.role)) continue;
      if (!permission || hasPermission(member.role, permission, member)) ids.add(member.userId);
    }
    return [...ids];
  }

  async notifyBrand(
    brandId: string,
    input: Omit<NotificationInput, 'userId' | 'dedupeKey'> & {
      dedupePrefix?: string;
      permission?: Permission;
      excludeUserId?: string;
    },
  ) {
    const { permission, excludeUserId, ...rest } = input;
    const recipients = (await this.brandRecipients(brandId, permission)).filter(
      (id) => id !== excludeUserId,
    );
    await this.createForUsers(recipients, rest);
  }

  /**
   * "You have a new message" — never the message text. At most one per conversation per
   * recipient while an earlier one is still unread (within 12 hours), so a live chat does
   * not turn into a stream of emails.
   */
  async notifyNewMessage(input: {
    messageId: string;
    conversationId: string;
    recipientIds: Iterable<string>;
    senderName: string;
    contextTitle: string;
    now?: Date;
  }) {
    const href = `/app/messages?c=${input.conversationId}`;
    const since = new Date((input.now ?? new Date()).getTime() - MESSAGE_QUIET_MS);
    for (const userId of new Set(input.recipientIds)) {
      const pending = await this.prisma.notification.findFirst({
        where: {
          userId,
          type: 'message.received',
          href,
          readAt: null,
          createdAt: { gte: since },
        },
        select: { id: true },
      });
      if (pending) continue;
      await this.create({
        userId,
        type: 'message.received',
        title: `New message from ${input.senderName}`,
        body: `You have a new message about ${input.contextTitle}. Open Woosh to read and reply.`,
        href,
        dedupeKey: `message:${input.messageId}:${userId}`,
      });
    }
  }

  private async emailNotification(input: NotificationInput) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: input.userId },
        select: { email: true, status: true, emailNotifications: true },
      });
      if (!user?.email || user.status !== UserStatus.ACTIVE || !user.emailNotifications) {
        return;
      }
      const message = inAppNotificationMessage({
        title: input.title,
        body: input.body,
        href: this.mail.frontendUrl(input.href || '/app/notifications'),
        ctaLabel: emailCtaLabel(input.type),
        settingsHref: this.mail.frontendUrl('/app/settings'),
      });
      await this.mail.sendBestEffort({ ...message, to: user.email });
    } catch (error) {
      this.logger.error(
        `Notification email failed (${input.type})`,
        error instanceof Error ? error.stack : error,
      );
    }
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
