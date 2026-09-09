import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';
import { PrismaOrderRepository } from '../dist/orders/infrastructure/persistence/prisma-order.repository.js';
import { PrismaPortfolioRepository } from '../dist/portfolio/infrastructure/persistence/prisma-portfolio.repository.js';
import { rebuildAccountSnapshot } from '../dist/shared/infrastructure/database/account-snapshot.store.js';
import { PrismaService } from '../dist/shared/infrastructure/database/prisma.service.js';

let app;
let prisma;
let url;
const createdUsers = [];
const createdInstruments = [];
before(async () => {
  assert.ok(new URL(process.env.DATABASE_URL).pathname.endsWith('_test'), 'Write tests require a dedicated *_test database');
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
  prisma = app.get(PrismaService);
});
after(async () => {
  try {
    if (prisma && createdUsers.length) {
      await prisma.order.deleteMany({ where: { userId: { in: createdUsers } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
    }
    if (prisma && createdInstruments.length) {
      await prisma.marketData.deleteMany({ where: { instrumentId: { in: createdInstruments } } });
      await prisma.instrument.deleteMany({ where: { id: { in: createdInstruments } } });
    }
  } finally { await app?.close(); }
});

async function user(cash = 1000) {
  const created = await prisma.user.create({ data: { email: `orders-${randomUUID()}@test.local` } });
  createdUsers.push(created.id);
  if (cash) await prisma.order.create({ data: { userId: created.id, instrumentId: 66, side: 'CASH_IN', type: 'MARKET', status: 'FILLED', size: cash, price: '1', datetime: new Date('2023-01-01') } });
  return created.id;
}
async function submit(id, body, status = 201) {
  const response = await fetch(`${url}/users/${id}/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, status);
  return response.json();
}
async function portfolio(id) { return (await fetch(`${url}/users/${id}/portfolio`)).json(); }
const market = { instrumentId: 1, side: 'BUY', type: 'MARKET', size: 2 };

test('MARKET uses latest close, persists FILLED, and immediately changes portfolio; SELL releases cash', async () => {
  const id = await user();
  const buy = await submit(id, market);
  assert.equal(buy.status, 'FILLED');
  assert.equal(buy.price, '259.00');
  const saved = await prisma.order.findUnique({ where: { id: BigInt(buy.id) } });
  assert.equal(saved.status, 'FILLED');
  assert.equal(saved.size, 2);
  assert.equal(saved.price.toFixed(2), '259.00');
  assert.equal((await portfolio(id)).availableCash, '482.00');
  const sell = await submit(id, { ...market, side: 'SELL', size: 1 });
  assert.equal(sell.status, 'FILLED');
  const result = await portfolio(id);
  assert.equal(result.availableCash, '741.00');
  assert.equal(result.positions.find(p => p.ticker === 'DYCA').quantity, 1);
});

test('MARKET and LIMIT amounts floor quantity at their respective prices', async () => {
  const id = await user();
  const order = await submit(id, { instrumentId: 1, side: 'BUY', type: 'MARKET', amount: '520.00' });
  assert.equal(order.size, 2);
  const limit = await submit(id, { instrumentId: 1, side: 'BUY', type: 'LIMIT', price: '100.00', amount: '250.00' });
  assert.equal(limit.size, 2);
  assert.equal(limit.status, 'NEW');
  const result = await portfolio(id);
  assert.equal(result.cashBalance, '482.00');
  assert.equal(result.reservedCash, '200.00');
  assert.equal(result.availableCash, '282.00');
  assert.equal(result.positions.find(p => p.ticker === 'DYCA').quantity, 2);
});

test('insufficient money or shares is persisted as REJECTED without changing balances', async () => {
  const id = await user(100);
  for (const side of ['BUY', 'SELL']) {
    const result = await submit(id, { ...market, side });
    assert.equal(result.status, 'REJECTED');
    assert.equal((await prisma.order.findUnique({ where: { id: BigInt(result.id) } })).status, 'REJECTED');
  }
  assert.equal((await portfolio(id)).availableCash, '100.00');
});

test('pending sell reserves shares; selling by amount checks remaining available shares', async () => {
  const id = await user();
  await submit(id, market);
  const pending = await submit(id, { ...market, type: 'LIMIT', side: 'SELL', price: '280.00' });
  assert.equal(pending.status, 'NEW');
  const result = await submit(id, { instrumentId: 1, side: 'SELL', type: 'MARKET', amount: '259.00' });
  assert.equal(result.status, 'REJECTED');
  assert.equal((await portfolio(id)).positions.find(p => p.ticker === 'DYCA').availableQuantity, 0);
});

test('concurrent MARKET buys and LIMIT reservations cannot spend the same cash twice', async () => {
  for (const type of ['MARKET', 'LIMIT']) {
    const id = await user(300);
    const body = { ...market, size: 1, type, ...(type === 'LIMIT' ? { price: '259.00' } : {}) };
    const results = await Promise.all([submit(id, body), submit(id, body)]);
    assert.deepEqual(results.map(o => o.status).sort(), [type === 'MARKET' ? 'FILLED' : 'NEW', 'REJECTED'].sort());
    assert.equal((await portfolio(id)).availableCash, '41.00');
  }
});

test('concurrent sells cannot sell the same shares twice', async () => {
  const id = await user();
  await submit(id, { ...market, size: 1 });
  const results = await Promise.all([submit(id, { ...market, side: 'SELL', size: 1 }), submit(id, { ...market, side: 'SELL', size: 1 })]);
  assert.deepEqual(results.map(o => o.status).sort(), ['FILLED', 'REJECTED']);
});

test('invalid requests never create orders; unknown references return 404', async () => {
  const id = await user();
  const initial = await prisma.order.count({ where: { userId: id } });
  for (const body of [
    null, [], {}, { ...market, size: 0 }, { ...market, size: 1.5 }, { ...market, size: '2' },
    { ...market, amount: '100' }, { ...market, price: '20' }, { ...market, side: 'CASH_IN' },
    { ...market, type: 'LIMIT' }, { ...market, type: 'LIMIT', price: '-1' },
    { ...market, type: 'LIMIT', price: '1.001' }, { ...market, instrumentId: 66 },
    { ...market, status: 'FILLED' }, { instrumentId: 1, side: 'BUY', type: 'MARKET', amount: '1.00' },
  ]) await submit(id, body, 400);
  await submit(id, { ...market, instrumentId: 2147483647 }, 404);
  await submit(2147483647, market, 404);
  assert.equal(await prisma.order.count({ where: { userId: id } }), initial);
});

test('missing market quote fails without saving; LIMIT uses its own price', async () => {
  const id = await user();
  // PGR exists in the seed but has no marketdata.
  await submit(id, { ...market, instrumentId: 3 }, 503);
  const limit = await submit(id, { ...market, instrumentId: 3, type: 'LIMIT', price: '10.00' });
  assert.equal(limit.status, 'NEW');
});

const transfer = { instrumentId: 66, side: 'CASH_IN', type: 'MARKET', size: 100 };

test('CASH_IN and CASH_OUT persist as orders at price one and update the ARS position', async () => {
  const id = await user(0);
  const incoming = await submit(id, transfer);
  assert.equal(incoming.status, 'FILLED');
  assert.equal(incoming.price, '1.00');
  const saved = await prisma.order.findUnique({ where: { id: BigInt(incoming.id) } });
  assert.equal(saved.side, 'CASH_IN');
  assert.equal(saved.size, 100);
  const outgoing = await submit(id, { instrumentId: 66, side: 'CASH_OUT', type: 'MARKET', amount: '40.00' });
  assert.equal(outgoing.status, 'FILLED');
  assert.equal(outgoing.size, 40);
  const result = await portfolio(id);
  assert.equal(result.availableCash, '60.00');
  assert.equal(result.totalValue, '60.00');
  assert.equal(result.positions.find(p => p.ticker === 'ARS').marketValue, '60.00');
});

test('CASH_OUT cannot consume reserved funds; rejection is persisted', async () => {
  const id = await user(100);
  await submit(id, { ...market, type: 'LIMIT', size: 1, price: '80.00' });
  const rejected = await submit(id, { ...transfer, side: 'CASH_OUT', size: 21 });
  assert.equal(rejected.status, 'REJECTED');
  assert.equal((await prisma.order.findUnique({ where: { id: BigInt(rejected.id) } })).status, 'REJECTED');
  assert.equal((await portfolio(id)).availableCash, '20.00');
  assert.equal((await submit(id, { ...transfer, side: 'CASH_OUT', size: 20 })).status, 'FILLED');
  assert.equal((await portfolio(id)).availableCash, '0.00');
});

test('transfers reject fractional pesos, LIMIT, a custom price and non-ARS instruments', async () => {
  const id = await user();
  const initial = await prisma.order.count({ where: { userId: id } });
  for (const body of [
    { ...transfer, size: 0 }, { ...transfer, size: -1 }, { ...transfer, size: 0.5 },
    { ...transfer, type: 'LIMIT', price: '1.00' }, { ...transfer, price: '1.00' },
    { ...transfer, instrumentId: 1 }, { ...transfer, size: undefined, amount: '1.50' },
    { ...transfer, size: undefined, amount: '2147483648.00' },
  ]) await submit(id, body, 400);
  assert.equal(await prisma.order.count({ where: { userId: id } }), initial);
});

test('concurrent withdrawals and purchases share the same account lock', async () => {
  const withdrawals = await user(100);
  const results = await Promise.all([
    submit(withdrawals, { ...transfer, side: 'CASH_OUT', size: 80 }),
    submit(withdrawals, { ...transfer, side: 'CASH_OUT', size: 80 }),
  ]);
  assert.deepEqual(results.map(o => o.status).sort(), ['FILLED', 'REJECTED']);
  assert.equal((await portfolio(withdrawals)).availableCash, '20.00');
  const mixed = await user(300);
  const mixedResults = await Promise.all([
    submit(mixed, { ...transfer, side: 'CASH_OUT', size: 259 }),
    submit(mixed, { ...market, size: 1 }),
  ]);
  assert.deepEqual(mixedResults.map(o => o.status).sort(), ['FILLED', 'REJECTED']);
  assert.equal((await portfolio(mixed)).availableCash, '41.00');
});

async function cancel(userId, orderId, expectedStatus = 200) {
  const response = await fetch(`${url}/users/${userId}/orders/${orderId}/cancel`, { method: 'POST' });
  assert.equal(response.status, expectedStatus);
  return response.json();
}

test('cancelling NEW BUY releases reserved cash and keeps the order history', async () => {
  const id = await user(100);
  const pending = await submit(id, { ...market, size: 1, type: 'LIMIT', price: '80.00' });
  assert.equal((await portfolio(id)).availableCash, '20.00');
  assert.deepEqual(await cancel(id, pending.id), { id: pending.id, userId: id.toString(), status: 'CANCELLED' });
  assert.equal((await prisma.order.findUnique({ where: { id: BigInt(pending.id) } })).status, 'CANCELLED');
  const result = await portfolio(id);
  assert.equal(result.availableCash, '100.00');
  assert.equal(result.reservedCash, '0.00');
  assert.equal(result.totalValue, '100.00');
  assert.equal((await submit(id, { ...transfer, side: 'CASH_OUT', size: 100 })).status, 'FILLED');
});

test('cancelling NEW SELL releases shares and preserves holdings and cost', async () => {
  const id = await user();
  await submit(id, market);
  const pending = await submit(id, { ...market, side: 'SELL', type: 'LIMIT', price: '300.00' });
  const before = (await portfolio(id)).positions.find(p => p.ticker === 'DYCA');
  assert.equal(before.availableQuantity, 0);
  await cancel(id, pending.id);
  const after = (await portfolio(id)).positions.find(p => p.ticker === 'DYCA');
  assert.equal(after.availableQuantity, 2);
  assert.equal(after.quantity, before.quantity);
  assert.equal(after.totalReturnPercent, before.totalReturnPercent);
  assert.equal((await submit(id, { ...market, side: 'SELL' })).status, 'FILLED');
});

test('FILLED, REJECTED and CANCELLED orders cannot be cancelled', async () => {
  const id = await user();
  const filled = await submit(id, { ...market, size: 1 });
  const rejected = await submit(id, { ...market, size: 100 });
  const pending = await submit(id, { ...market, size: 1, type: 'LIMIT', price: '1.00' });
  await cancel(id, pending.id);
  for (const order of [filled, rejected, { ...pending, status: 'CANCELLED' }]) {
    await cancel(id, order.id, 409);
    assert.equal((await prisma.order.findUnique({ where: { id: BigInt(order.id) } })).status, order.status);
  }
});

test('cancellation enforces ownership and rejects nonexistent or invalid identifiers', async () => {
  const owner = await user();
  const other = await user();
  const pending = await submit(owner, { ...market, type: 'LIMIT', price: '1.00' });
  await cancel(other, pending.id, 404);
  await cancel(owner, 2147483647, 404);
  await cancel(2147483647, pending.id, 404);
  for (const orderId of ['abc', 1.5]) await cancel(owner, orderId, 400);
  assert.equal((await prisma.order.findUnique({ where: { id: BigInt(pending.id) } })).status, 'NEW');
});

test('two cancellations only release the reservation once', async () => {
  const id = await user(100);
  const pending = await submit(id, { ...market, size: 1, type: 'LIMIT', price: '80.00' });
  const responses = await Promise.all([1, 2].map(() => fetch(`${url}/users/${id}/orders/${pending.id}/cancel`, { method: 'POST' })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal((await portfolio(id)).availableCash, '100.00');
});

test('a BUY amount exceeding available funds is REJECTED even if rounded share cost fits', async () => {
  const id = await user(100);
  const result = await submit(id, { instrumentId: 1, side: 'BUY', type: 'LIMIT', amount: '110.00', price: '60.00' });
  assert.equal(result.size, 1);
  assert.equal(result.status, 'REJECTED');
  assert.equal((await prisma.order.findUnique({ where: { id: BigInt(result.id) } })).status, 'REJECTED');
  assert.equal((await portfolio(id)).availableCash, '100.00');
});


test('IDs above the JS safe-integer limit survive searches, orders, portfolios and cancellation', async () => {
  const id = 9007199254740993n;
  for (const userId of [id - 1n, id]) {
    await prisma.user.create({ data: { id: userId } });
    createdUsers.push(userId);
  }
  await prisma.instrument.create({ data: { id, ticker: 'BIGIDTEST', name: 'Bigint test', type: 'ACCIONES' } });
  createdInstruments.push(id);
  await prisma.marketData.create({ data: { id, instrumentId: id, close: '10', previousClose: '9', date: new Date('2026-01-01') } });
  await submit(id, { ...transfer, instrumentId: '66' });
  const buy = await submit(id, { ...market, instrumentId: id.toString() });
  assert.equal(buy.userId, id.toString());
  assert.equal(buy.instrumentId, id.toString());
  const result = await portfolio(id);
  assert.equal(result.userId, id.toString());
  assert.equal(result.positions.find(p => p.ticker === 'BIGIDTEST').instrumentId, id.toString());
  assert.equal(result.availableCash, '80.00');
  assert.equal((await portfolio(id - 1n)).availableCash, '0.00');
  const search = await (await fetch(`${url}/instruments?query=BIGIDTEST`)).json();
  assert.equal(search[0].id, id.toString());
  const pending = await submit(id, { ...market, instrumentId: id.toString(), type: 'LIMIT', price: '10', size: 1 });
  await prisma.order.update({ where: { id: BigInt(pending.id) }, data: { id } });
  await cancel(id - 1n, id, 404);
  assert.deepEqual(await cancel(id, id), { id: id.toString(), userId: id.toString(), status: 'CANCELLED' });
});


const snapshotState = row => ({ cash: row.cash.toString(), reservedCash: row.reservedCash.toString(), positions: row.positions });

test('persisted snapshots match reconstruction after fills, reservations, rejections and cancellations', async () => {
  const id = await user(1000);
  await submit(id, { ...market, size: 2 });
  await submit(id, { ...market, side: 'SELL', size: 1 });
  const pending = await submit(id, { ...market, type: 'LIMIT', size: 1, price: '20' });
  await cancel(id, pending.id);
  await submit(id, { ...market, side: 'SELL', type: 'LIMIT', size: 1, price: '300' });
  await submit(id, { ...transfer, side: 'CASH_OUT', size: 41 });
  const stored = await prisma.accountSnapshot.findUniqueOrThrow({ where: { userId: id } });
  assert.equal(stored.cash.toString(), '700');
  assert.equal(stored.reservedCash.toString(), '0');
  assert.deepEqual(stored.positions, [{ instrumentId: '1', quantity: 1, reservedQuantity: 1, cost: '259', inconsistent: false }]);
  await submit(id, { ...market, size: 100 });
  await portfolio(id);
  const unchanged = await prisma.accountSnapshot.findUniqueOrThrow({ where: { userId: id } });
  assert.deepEqual(unchanged, stored, 'Rejected orders and ordinary reads must not rewrite the snapshot');
  for (let repeat = 0; repeat < 2; repeat++) {
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
      await rebuildAccountSnapshot(tx, id);
    });
    assert.deepEqual(snapshotState(await prisma.accountSnapshot.findUniqueOrThrow({ where: { userId: id } })), snapshotState(stored));
  }
});

test('orders and snapshot changes roll back together on a failed transaction', async () => {
  const id = await user(100);
  await portfolio(id);
  const before = await prisma.accountSnapshot.findUniqueOrThrow({ where: { userId: id } });
  const ordersBefore = await prisma.order.count({ where: { userId: id } });
  const repository = new PrismaOrderRepository(prisma);
  await assert.rejects(repository.withUserLock(id, async transaction => {
    await transaction.save({ userId: id, instrumentId: 66n, side: 'CASH_OUT', type: 'MARKET', status: 'FILLED', size: 40, price: '1' });
    throw new Error('Simulated transaction failure');
  }), /Simulated transaction failure/);
  assert.equal(await prisma.order.count({ where: { userId: id } }), ordersBefore);
  assert.deepEqual(await prisma.accountSnapshot.findUniqueOrThrow({ where: { userId: id } }), before);
});

test('bootstrap streams more than one ledger page; subsequent reads and submissions skip history', async () => {
  const id = await user(0);
  await prisma.order.createMany({ data: Array.from({ length: 1005 }, (_, index) => ({ userId: id, instrumentId: 66n, side: 'CASH_IN', type: 'MARKET', status: 'FILLED', size: 1, price: '1', datetime: new Date(index % 2 ? '2023-01-01' : '2023-01-02') })) });
  let historyQueries = 0;
  const tracked = prisma.$extends({ query: { order: { async findMany({ args, query }) { historyQueries++; return query(args); } } } });
  const portfolios = new PrismaPortfolioRepository(tracked);
  const first = await portfolios.findByUserId(id);
  assert.equal(first.account.cash, '1005');
  assert.equal(historyQueries, 2);
  historyQueries = 0;
  await portfolios.findByUserId(id);
  await new PrismaOrderRepository(tracked).withUserLock(id, async transaction => {
    assert.equal((await transaction.readSnapshot()).cash, '1005');
    await transaction.save({ userId: id, instrumentId: 66n, side: 'CASH_OUT', type: 'MARKET', status: 'FILLED', size: 5, price: '1' });
  });
  assert.equal((await portfolios.findByUserId(id)).account.cash, '1000');
  assert.equal(historyQueries, 0);
});

test('fresh quotes revalue the portfolio without changing the stored snapshot', async () => {
  const id = await user(100);
  const instrument = await prisma.instrument.create({ data: { ticker: 'SNAPQUOTE', name: 'Snapshot quote test', type: 'ACCIONES' } });
  createdInstruments.push(instrument.id);
  const quote = await prisma.marketData.create({ data: { instrumentId: instrument.id, close: '10', previousClose: '10', date: new Date('2026-01-01') } });
  await submit(id, { ...market, instrumentId: instrument.id.toString() });
  const stored = await prisma.accountSnapshot.findUniqueOrThrow({ where: { userId: id } });
  await prisma.marketData.update({ where: { id: quote.id }, data: { close: '20' } });
  const result = await portfolio(id);
  assert.equal(result.totalValue, '120.00');
  assert.equal(result.positions.find(p => p.ticker === 'SNAPQUOTE').dailyReturnPercent, '100.00');
  assert.deepEqual(await prisma.accountSnapshot.findUniqueOrThrow({ where: { userId: id } }), stored);
});

test('a failed snapshot write rolls back order creation and cancellation', async () => {
  const id = await user(100);
  const pending = await submit(id, { ...market, size: 1, type: 'LIMIT', price: '20' });
  const before = await prisma.accountSnapshot.findUniqueOrThrow({ where: { userId: id } });
  const count = await prisma.order.count({ where: { userId: id } });
  const failing = prisma.$extends({ query: { accountSnapshot: { upsert() { throw new Error('Snapshot write failed'); } } } });
  const repository = new PrismaOrderRepository(failing);
  await assert.rejects(repository.withUserLock(id, transaction => transaction.save({ userId: id, instrumentId: 66n, side: 'CASH_OUT', type: 'MARKET', status: 'FILLED', size: 10, price: '1' })), /Snapshot write failed/);
  assert.equal(await prisma.order.count({ where: { userId: id } }), count);
  await assert.rejects(repository.withUserLock(id, transaction => transaction.cancel(BigInt(pending.id))), /Snapshot write failed/);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: BigInt(pending.id) } })).status, 'NEW');
  assert.deepEqual(await prisma.accountSnapshot.findUniqueOrThrow({ where: { userId: id } }), before);
});
