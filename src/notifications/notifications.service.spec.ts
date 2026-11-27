/* eslint-disable @typescript-eslint/require-await -- the in-memory Prisma fake mirrors Prisma's async API. */
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { RecordingMail } from '../test-support/notifications';
import { EMAIL_NOTIFICATION_TYPES } from './email-policy';
import { NotificationsService } from './notifications.service';

type Row = {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  href: string | null;
  dedupeKey: string | null;
  readAt: Date | null;
  createdAt: Date;
};

type User = {
  id: string;
  email: string;
  name: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'PENDING_VERIFICATION';
  emailNotifications: boolean;
  weeklyDigest: boolean;
};

/** Just enough of Prisma for NotificationsService, with a real unique dedupeKey. */
function fakePrisma(users: User[], brands: Record<string, unknown> = {}) {
  const rows: Row[] = [];
  const audits: Array<{ action: string; targetId: string }> = [];
  let seq = 0;
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'createdAt') {
        const range = value as { gte?: Date; lt?: Date };
        return (
          (!range.gte || row.createdAt >= range.gte) &&
          (!range.lt || row.createdAt < range.lt)
        );
      }
      return (row as Record<string, unknown>)[key] === value;
    });
  const prisma = {
    notification: {
      findUnique: async ({ where }: { where: { dedupeKey: string } }) =>
        rows.find((row) => row.dedupeKey === where.dedupeKey) ?? null,
      findUniqueOrThrow: async ({
        where,
      }: {
        where: { dedupeKey: string };
      }) => {
        const row = rows.find((r) => r.dedupeKey === where.dedupeKey);
        if (!row) throw new Error('not found');
        return row;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        rows.find((row) => matches(row, where)) ?? null,
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        rows.filter((row) => matches(row, where)),
      create: async ({
        data,
      }: {
        data: Omit<Row, 'id' | 'readAt' | 'createdAt'>;
      }) => {
        if (
          data.dedupeKey &&
          rows.some((row) => row.dedupeKey === data.dedupeKey)
        ) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint', {
            code: 'P2002',
            clientVersion: 'test',
          });
        }
        const row: Row = {
          id: `n${++seq}`,
          readAt: null,
          createdAt: new Date(),
          ...data,
          href: data.href ?? null,
          dedupeKey: data.dedupeKey ?? null,
        };
        rows.push(row);
        return row;
      },
    },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        users.find((user) => user.id === where.id) ?? null,
      findMany: async () =>
        users.filter(
          (u) =>
            u.status === 'ACTIVE' && u.emailNotifications && u.weeklyDigest,
        ),
    },
    brand: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        brands[where.id] ?? null,
    },
    auditEvent: {
      findFirst: async ({
        where,
      }: {
        where: { action: string; targetId: string };
      }) =>
        audits.find(
          (a) => a.action === where.action && a.targetId === where.targetId,
        ) ?? null,
      create: async ({
        data,
      }: {
        data: { action: string; targetId: string };
      }) => {
        audits.push(data);
        return data;
      },
    },
  };
  return { prisma: prisma as unknown as PrismaService, rows };
}

const creator: User = {
  id: 'u-creator',
  email: 'creator@woosh.test',
  name: 'Ada',
  status: 'ACTIVE',
  emailNotifications: true,
  weeklyDigest: true,
};

function setup(users: User[] = [creator], brands?: Record<string, unknown>) {
  const { prisma, rows } = fakePrisma(users, brands);
  const mail = new RecordingMail('https://app.woosh.test');
  return { service: new NotificationsService(prisma, mail), mail, rows };
}

const accepted = {
  userId: creator.id,
  type: 'application.accepted',
  title: "You're on the campaign",
  body: 'Summer launch',
  href: '/app/campaigns/c1',
  dedupeKey: 'application-accepted:a1',
};

describe('NotificationsService.create', () => {
  it('records the in-app notification and emails an important event', async () => {
    const { service, mail, rows } = setup();
    await service.create(accepted);
    expect(rows).toHaveLength(1);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({
      to: creator.email,
      subject: "You're on the campaign",
    });
  });

  it('links to the frontend page, and to settings, using FRONTEND_URL', async () => {
    const { service, mail } = setup();
    await service.create(accepted);
    const { html, text } = mail.sent[0];
    expect(html).toContain('href="https://app.woosh.test/app/campaigns/c1"');
    expect(text).toContain('https://app.woosh.test/app/campaigns/c1');
    expect(html).toContain('https://app.woosh.test/app/settings');
  });

  it('keeps the in-app notification but sends no email when email notifications are off', async () => {
    const { service, mail, rows } = setup([
      { ...creator, emailNotifications: false },
    ]);
    await service.create(accepted);
    expect(rows).toHaveLength(1);
    expect(mail.sent).toHaveLength(0);
  });

  it('never emails suspended or unverified accounts', async () => {
    for (const status of ['SUSPENDED', 'PENDING_VERIFICATION'] as const) {
      const { service, mail, rows } = setup([{ ...creator, status }]);
      await service.create(accepted);
      expect(rows).toHaveLength(1);
      expect(mail.sent).toHaveLength(0);
    }
  });

  it('does not email routine, in-app-only events', async () => {
    const { service, mail, rows } = setup();
    expect(EMAIL_NOTIFICATION_TYPES.has('payment.payout.initiated')).toBe(
      false,
    );
    await service.create({
      ...accepted,
      type: 'payment.payout.initiated',
      dedupeKey: 'p1',
    });
    expect(rows).toHaveLength(1);
    expect(mail.sent).toHaveLength(0);
  });

  it('respects an explicit email: false override', async () => {
    const { service, mail } = setup();
    await service.create({ ...accepted, email: false });
    expect(mail.sent).toHaveLength(0);
  });

  it('sends one email when the same event is recorded again (retry)', async () => {
    const { service, mail, rows } = setup();
    await service.create(accepted);
    await service.create(accepted);
    expect(rows).toHaveLength(1);
    expect(mail.sent).toHaveLength(1);
  });

  it('sends one email when two requests race to record the same event', async () => {
    const { service, mail, rows } = setup();
    await Promise.all([service.create(accepted), service.create(accepted)]);
    expect(rows).toHaveLength(1);
    expect(mail.sent).toHaveLength(1);
  });

  it('does not throw when Resend fails; the notification is still recorded', async () => {
    const { service, mail, rows } = setup();
    mail.fail = true;
    await expect(service.create(accepted)).resolves.toMatchObject({
      type: 'application.accepted',
    });
    expect(rows).toHaveLength(1);
  });

  it('does not throw when looking up the recipient fails', async () => {
    const { service, rows } = setup();
    // Simulate the user lookup itself failing (e.g. a dropped connection).
    (
      service as unknown as { prisma: { user: { findUnique: () => never } } }
    ).prisma.user.findUnique = () => {
      throw new Error('connection reset');
    };
    await expect(service.create(accepted)).resolves.toBeTruthy();
    expect(rows).toHaveLength(1);
  });
});

describe('NotificationsService.brandRecipients', () => {
  const brands = {
    b1: {
      memberships: [
        { userId: 'scoped-manager', role: 'MANAGER' },
        { userId: 'scoped-viewer', role: 'VIEWER' },
      ],
      organisation: {
        memberships: [
          { userId: 'owner', role: 'OWNER' },
          {
            userId: 'finance-flag-admin',
            role: 'ADMIN',
            canApprovePayments: true,
          },
          // Scoped to a different brand in the same agency: must never be told about b1.
          { userId: 'other-brand-manager', role: 'MANAGER' },
        ],
      },
    },
  };

  it('includes brand members and org owners/admins, not other brands’ teammates', async () => {
    const { service } = setup([], brands);
    const ids = await service.brandRecipients('b1');
    expect(ids.sort()).toEqual(
      ['finance-flag-admin', 'owner', 'scoped-manager', 'scoped-viewer'].sort(),
    );
  });

  it('filters by permission when asked (e.g. payments)', async () => {
    const { service } = setup([], brands);
    const ids = await service.brandRecipients('b1', 'payments.approve');
    expect(ids.sort()).toEqual(['finance-flag-admin', 'owner']);
  });
});

describe('NotificationsService.notifyNewMessage', () => {
  const input = {
    messageId: 'm1',
    conversationId: 'conv1',
    recipientIds: [creator.id],
    senderName: 'Glow Co',
    contextTitle: 'Summer launch',
  };

  it('emails that a message is waiting, without the message content', async () => {
    const { service, mail, rows } = setup();
    await service.notifyNewMessage(input);
    expect(rows[0]).toMatchObject({
      type: 'message.received',
      href: '/app/messages?c=conv1',
    });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].subject).toBe('New message from Glow Co');
    expect(mail.sent[0].html).toContain(
      'https://app.woosh.test/app/messages?c=conv1',
    );
  });

  it('sends one email per conversation while the earlier one is unread', async () => {
    const { service, mail, rows } = setup();
    await service.notifyNewMessage(input);
    await service.notifyNewMessage({ ...input, messageId: 'm2' });
    await service.notifyNewMessage({ ...input, messageId: 'm3' });
    expect(rows).toHaveLength(1);
    expect(mail.sent).toHaveLength(1);
  });

  it('notifies again once the earlier notification was read', async () => {
    const { service, mail, rows } = setup();
    await service.notifyNewMessage(input);
    rows[0].readAt = new Date();
    await service.notifyNewMessage({ ...input, messageId: 'm2' });
    expect(mail.sent).toHaveLength(2);
  });
});

describe('NotificationsService.sendWeeklyDigests (unchanged behaviour)', () => {
  it('emails last week’s notifications once per week, and skips a second run', async () => {
    const { service, mail, rows } = setup();
    const now = new Date('2026-11-25T09:00:00Z'); // Wednesday
    rows.push({
      id: 'old',
      userId: creator.id,
      type: 'deliverable.approved',
      title: 'Deliverable approved',
      body: 'Reel 1',
      href: null,
      dedupeKey: null,
      readAt: null,
      createdAt: new Date('2026-11-18T10:00:00Z'), // previous week
    });
    const first = await service.sendWeeklyDigests(now);
    const second = await service.sendWeeklyDigests(now);
    expect(first).toMatchObject({ eligible: 1, sent: 1 });
    expect(second).toMatchObject({ sent: 0, skipped: 1 });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].subject).toBe('Your weekly Woosh update');
    expect(mail.sent[0].html).toContain(
      'https://app.woosh.test/app/notifications',
    );
  });

  it('does not send a digest to users who turned it off', async () => {
    const { service, mail } = setup([{ ...creator, weeklyDigest: false }]);
    expect(await service.sendWeeklyDigests()).toMatchObject({
      eligible: 0,
      sent: 0,
    });
    expect(mail.sent).toHaveLength(0);
  });
});
