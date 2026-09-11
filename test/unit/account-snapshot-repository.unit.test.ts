import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
import type { AccountSnapshot } from '../../src/generated/prisma/client.js';
import { PrismaAccountSnapshotRepository } from '../../src/snapshot/infrastructure/persistence/account-snapshot.repository.js';

// Prisma is constructed lazily; all operations used here are intercepted without connecting.
function client() {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: 'postgresql://unused:unused@127.0.0.1:1/unused' }) });
}

void test('reading a missing snapshot returns null without reading orders or writing', async t => {
  const db = client();
  t.after(() => db.$disconnect());
  const accountSnapshot = { ...db.accountSnapshot };
  const orders = { ...db.order };
  t.mock.property(db, 'accountSnapshot', accountSnapshot);
  t.mock.property(db, 'order', orders);
  t.mock.method(accountSnapshot, 'findUnique', async ({ where }: Prisma.AccountSnapshotFindUniqueArgs): Promise<AccountSnapshot | null> => {
    assert.equal(where.userId, 1n);
    return null;
  });
  t.mock.method(accountSnapshot, 'upsert', () => assert.fail('A read must not write'));
  t.mock.method(orders, 'findMany', () => assert.fail('A read must not replay orders'));
  assert.equal(await new PrismaAccountSnapshotRepository(db).read(1n), null);
});

void test('initializing an existing snapshot preserves it without replaying or writing', async t => {
  const db = client();
  t.after(() => db.$disconnect());
  const accountSnapshot = { ...db.accountSnapshot };
  const orders = { ...db.order };
  t.mock.property(db, 'accountSnapshot', accountSnapshot);
  t.mock.property(db, 'order', orders);
  t.mock.method(accountSnapshot, 'findUnique', async (): Promise<AccountSnapshot> => ({
    userId: 1n, updatedAt: new Date('2026-01-01'), settledCash: new Prisma.Decimal('100'), reservedCash: new Prisma.Decimal('20'), positions: [],
  }));
  t.mock.method(accountSnapshot, 'upsert', () => assert.fail('Existing snapshot must not be overwritten'));
  t.mock.method(orders, 'findMany', () => assert.fail('Existing snapshot must not be rebuilt'));
  assert.deepEqual(await new PrismaAccountSnapshotRepository(db).initialize(1n), { settledCash: '100', reservedCash: '20', positions: [] });
});
