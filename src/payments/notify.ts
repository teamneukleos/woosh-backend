import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export async function notify(
  prisma: PrismaService | Prisma.TransactionClient,
  input: {
    userId: string;
    type: string;
    title: string;
    body: string;
    href?: string;
    dedupeKey?: string;
  },
) {
  if (input.dedupeKey) {
    await prisma.notification.upsert({
      where: { dedupeKey: input.dedupeKey },
      create: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        href: input.href,
        dedupeKey: input.dedupeKey,
      },
      update: {},
    });
    return;
  }
  await prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      href: input.href,
    },
  });
}
