import { PrismaAccountSnapshotRepository } from '../../src/account-snapshot/infrastructure/persistence/account-snapshot.repository.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { PrismaService } from '../../src/shared/infrastructure/database/prisma.service.js';
import { AmbiguousPortfolioAccountError } from '../../src/portfolio/application/ports/portfolio.repository.js';
import { PrismaPortfolioRepository } from '../../src/portfolio/infrastructure/persistence/prisma-portfolio.repository.js';

void test('duplicate account matches fail before reading snapshots or quotes', async t => {
  // The constructor is lazy; restore the environment before running any asynchronous work.
  const previousUrl = process.env.DATABASE_URL;
  let db: PrismaService;
  try {
    process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/unused';
    db = new PrismaService();
  } finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  }
  t.after(() => db.$disconnect());
  const users = { ...db.user };
  const instruments = { ...db.instrument };
  t.mock.property(db, 'user', users);
  t.mock.property(db, 'instrument', instruments);
  t.mock.method(users, 'findMany', async (): Promise<Prisma.UserGetPayload<{ select: { id: true } }>[]> => [{ id: 1n }, { id: 2n }]);
  t.mock.method(instruments, 'findMany', () => assert.fail('Ambiguous accounts must not read quotes'));
  t.mock.method(PrismaAccountSnapshotRepository.prototype, 'read', () => assert.fail('Ambiguous accounts must not read snapshots'));
  const repository = new PrismaPortfolioRepository(db, new PrismaAccountSnapshotRepository(db));
  await assert.rejects(repository.findByAccountNumber('duplicate'), AmbiguousPortfolioAccountError);
});
