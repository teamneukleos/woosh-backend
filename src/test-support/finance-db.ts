// Service-level test support for money flows. Runs against a real, disposable
// Postgres so transactions, unique constraints and concurrent requests behave
// exactly as in production. Never point this at staging or production.
//
//   createdb woosh_finance_test
//   DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy
//   TEST_DATABASE_URL=postgresql://localhost:5432/woosh_finance_test?schema=public npm run test:finance

import { PrismaService } from '../prisma/prisma.service';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** Returns the test URL only if it is unmistakably a local throwaway database. */
export function financeTestDatabaseUrl() {
  const raw = process.env.TEST_DATABASE_URL?.trim();
  if (!raw) return null;
  const url = new URL(raw);
  const database = url.pathname.replace(/^\//, '');
  if (!LOCAL_HOSTS.has(url.hostname) || !/test/i.test(database)) {
    throw new Error(
      'TEST_DATABASE_URL must be a local database whose name contains "test". Refusing to run.',
    );
  }
  return raw;
}

/** `describe` that only runs when a local test database is configured. */
export const describeWithDb = financeTestDatabaseUrl()
  ? describe
  : describe.skip;

export function createTestPrisma() {
  const url = financeTestDatabaseUrl();
  if (!url) throw new Error('TEST_DATABASE_URL is not set.');
  return new PrismaService({ datasourceUrl: url });
}

export async function resetDatabase(prisma: PrismaService) {
  const tables = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`,
  );
  if (!tables.length) return;
  const list = tables.map((row) => `"${row.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  );
}

let counter = 0;
const unique = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(counter += 1)}`;

/** Brand owner with an org, a brand and an (optionally funded) wallet. */
export async function createFundedBrand(prisma: PrismaService, balance = 0) {
  const owner = await prisma.user.create({
    data: {
      email: `${unique('owner')}@test.woosh`,
      status: 'ACTIVE',
      emailVerified: new Date(),
    },
  });
  const organisation = await prisma.organisation.create({
    data: {
      type: 'BRAND',
      legalName: 'Test Brand Ltd',
      publicName: 'Test Brand',
    },
  });
  await prisma.membership.create({
    data: { organisationId: organisation.id, userId: owner.id, role: 'OWNER' },
  });
  const brand = await prisma.brand.create({
    data: { organisationId: organisation.id, name: 'Test Brand' },
  });
  const wallet = await prisma.brandWallet.create({
    data: { brandId: brand.id, balance },
  });
  return { owner, organisation, brand, wallet };
}

export async function createCreator(prisma: PrismaService) {
  const user = await prisma.user.create({
    data: {
      email: `${unique('creator')}@test.woosh`,
      status: 'ACTIVE',
      emailVerified: new Date(),
    },
  });
  const profile = await prisma.creatorProfile.create({
    data: { userId: user.id, displayName: 'Test Creator' },
  });
  return { user, profile };
}

/** An open brief with one application at `rate`, ready for the brand to accept. */
export async function createApplication(
  prisma: PrismaService,
  input: {
    brandId: string;
    creatorProfileId: string;
    rate: number;
    maxCreators?: number;
  },
) {
  const brief = await prisma.brief.create({
    data: {
      brandId: input.brandId,
      title: 'Test brief',
      description: 'Test brief description',
      status: 'OPEN',
      rateAmount: input.rate,
      maxCreators: input.maxCreators,
      deliverables: [{ title: 'Reel' }],
    },
  });
  const application = await prisma.application.create({
    data: {
      briefId: brief.id,
      creatorProfileId: input.creatorProfileId,
      status: 'APPLIED',
    },
  });
  return { brief, application };
}

export async function walletBalance(prisma: PrismaService, brandId: string) {
  const wallet = await prisma.brandWallet.findUniqueOrThrow({
    where: { brandId },
  });
  return Number(wallet.balance);
}
