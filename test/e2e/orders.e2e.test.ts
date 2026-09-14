import type { OrderRepository } from '../../src/orders/application/ports/order.repository.js';
import { orderResponse, cancellationResponse, errorResponse, instrumentPage, portfolioResponse } from '../support/http.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import type { AccountSnapshot } from '../../src/generated/prisma/client.js';
import type { INestApplication } from '@nestjs/common';
import { present } from '../support/assertions.js';
import { InstrumentType } from '../../src/shared/domain/instrument-type.js';
import { OrderStatus } from '../../src/shared/domain/order-status.js';
import { OrderType } from '../../src/shared/domain/order-type.js';
import { OrderSide } from '../../src/shared/domain/order-side.js';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module.js';
import { SubmitOrderUseCase } from '../../src/orders/application/submit-order.use-case.js';
import { PrismaOrderRepository } from '../../src/orders/infrastructure/persistence/prisma-order.repository.js';
import { PrismaPortfolioRepository } from '../../src/portfolio/infrastructure/persistence/prisma-portfolio.repository.js';
import { PrismaAccountSnapshotRepository } from '../../src/account-snapshot/infrastructure/persistence/account-snapshot.repository.js';
import { PrismaService } from '../../src/shared/infrastructure/database/prisma.service.js';

let app: INestApplication;
let prisma: PrismaService;
let url: string;
const createdUsers: bigint[] = [];
const createdInstruments: bigint[] = [];
before(async () => {
  assert.ok(new URL(present(process.env.DATABASE_URL)).pathname.endsWith('_test'), 'Write tests require a dedicated *_test database');
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
  const created = await prisma.user.create({ data: { email: `orders-${randomUUID()}@test.local`, accountNumber: randomUUID().replace(/-/g, '').slice(0, 20) } });
  createdUsers.push(created.id);
  if (cash) await prisma.order.create({ data: { userId: created.id, instrumentId: 66, side: OrderSide.CASH_IN, type: OrderType.MARKET, status: OrderStatus.FILLED, size: cash, price: '1', datetime: new Date('2023-01-01') } });
  return created.id;
}
function submit(id: bigint | number | string, body: unknown, status?: 200 | 201): Promise<ReturnType<typeof orderResponse.parse>>;
function submit(id: bigint | number | string, body: unknown, status: number): Promise<ReturnType<typeof errorResponse.parse>>;
async function submit(id: bigint | number | string, body: unknown, status = 201) {
  const response = await fetch(`${url}/users/${id}/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body && typeof body === 'object' && !Array.isArray(body) ? { transactionId: randomUUID(), ...body } : body) });
  assert.equal(response.status, status);
  return status < 400 ? orderResponse.parse(await response.json()) : errorResponse.parse(await response.json());
}
async function portfolio(id: bigint | number | string) {
  const response = await fetch(`${url}/users/${id}/portfolio`);
  assert.equal(response.status, 200);
  return portfolioResponse.parse(await response.json());
}
const market = { instrumentId: 1, side: OrderSide.BUY, type: OrderType.MARKET, size: 2 };

const transfer = { instrumentId: 66, side: OrderSide.CASH_IN, type: OrderType.MARKET, size: 100 };

async function cancel(userId: bigint | number | string, orderId: bigint | number | string, expectedStatus = 200) {
  const response = await fetch(`${url}/users/${userId}/orders/${orderId}/cancel`, { method: 'POST' });
  assert.equal(response.status, expectedStatus);
  return expectedStatus < 400 ? cancellationResponse.parse(await response.json()) : errorResponse.parse(await response.json());
}

const snapshotState = (row: AccountSnapshot) => ({ settledCash: row.settledCash.toString(), reservedCash: row.reservedCash.toString(), positions: row.positions });

void describe('HTTP: order submission and cash transfers', () => {
  void test('MARKET uses latest close, persists FILLED, and immediately changes portfolio; SELL releases cash', async () => {
    const id = await user();
    const buy = await submit(id, market);
    assert.equal(buy.status, 'FILLED');
    assert.equal(buy.price, '259.00');
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: BigInt(buy.id) } });
    assert.equal(saved.status, 'FILLED');
    assert.equal(saved.size, 2);
    assert.equal(saved.price.toFixed(2), '259.00');
    assert.equal((await portfolio(id)).availableCash, '482.00');
    const sell = await submit(id, { ...market, side: OrderSide.SELL, size: 1 });
    assert.equal(sell.status, 'FILLED');
    const result = await portfolio(id);
    assert.equal(result.availableCash, '741.00');
    assert.equal(present(result.positions.find(p => p.ticker === 'DYCA')).quantity, 1);
  });

  void test('MARKET and LIMIT amounts floor quantity at their respective prices', async () => {
    const id = await user();
    const order = await submit(id, { instrumentId: 1, side: OrderSide.BUY, type: OrderType.MARKET, amount: '520.00' });
    assert.equal(order.size, 2);
    const limit = await submit(id, { instrumentId: 1, side: OrderSide.BUY, type: OrderType.LIMIT, price: '100.00', amount: '250.00' });
    assert.equal(limit.size, 2);
    assert.equal(limit.status, 'NEW');
    const result = await portfolio(id);
    assert.equal(result.cashBalance, '482.00');
    assert.equal(result.reservedCash, '200.00');
    assert.equal(result.availableCash, '282.00');
    assert.equal(present(result.positions.find(p => p.ticker === 'DYCA')).quantity, 2);
  });

  void test('insufficient money or shares is persisted as REJECTED without changing balances', async () => {
    const id = await user(100);
    for (const side of ['BUY', 'SELL']) {
      const result = await submit(id, { ...market, side });
      assert.equal(result.status, 'REJECTED');
      assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: BigInt(result.id) } })).status, 'REJECTED');
    }
    assert.equal((await portfolio(id)).availableCash, '100.00');
  });

  void test('pending sell reserves shares; selling by amount checks remaining available shares', async () => {
    const id = await user();
    await submit(id, market);
    const pending = await submit(id, { ...market, type: OrderType.LIMIT, side: OrderSide.SELL, price: '280.00' });
    assert.equal(pending.status, 'NEW');
    const result = await submit(id, { instrumentId: 1, side: OrderSide.SELL, type: OrderType.MARKET, amount: '259.00' });
    assert.equal(result.status, 'REJECTED');
    assert.equal(present((await portfolio(id)).positions.find(p => p.ticker === 'DYCA')).availableQuantity, 0);
  });

  void test('invalid requests never create orders; unknown references return 404', async () => {
    const id = await user();
    const initial = await prisma.order.count({ where: { userId: id } });
    for (const body of [
      null, [], {}, { ...market, size: 0 }, { ...market, size: 1.5 }, { ...market, size: '2' },
      { ...market, instrumentId: Number('9007199254740993') },
      { ...market, instrumentId: '9223372036854775808' },
      { ...market, amount: '100' }, { ...market, price: '20' }, { ...market, side: OrderSide.CASH_IN },
      { ...market, type: OrderType.LIMIT }, { ...market, type: OrderType.LIMIT, price: '-1' },
      { ...market, type: OrderType.LIMIT, price: '1.001' }, { ...market, instrumentId: 66 },
      { ...market, status: OrderStatus.FILLED }, { instrumentId: 1, side: OrderSide.BUY, type: OrderType.MARKET, amount: '1.00' },
    ]) await submit(id, body, 400);
    await submit(id, { ...market, instrumentId: 2147483647 }, 404);
    await submit(2147483647, market, 404);
    assert.equal(await prisma.order.count({ where: { userId: id } }), initial);
  });

  void test('missing market quote fails without saving; LIMIT uses its own price', async () => {
    const id = await user();
    const before = await prisma.order.count({ where: { userId: id } });
    // PGR exists in the seed but has no marketdata.
    await submit(id, { ...market, instrumentId: 3 }, 503);
    assert.equal(await prisma.order.count({ where: { userId: id } }), before);
    assert.equal(await prisma.accountSnapshot.findUnique({ where: { userId: id } }), null);
    const limit = await submit(id, { ...market, instrumentId: 3, type: OrderType.LIMIT, price: '10.00' });
    assert.equal(limit.status, 'NEW');
  });

  void test('CASH_IN and CASH_OUT persist as orders at price one and update the ARS position', async () => {
    const id = await user(0);
    const incoming = await submit(id, transfer);
    assert.equal(incoming.status, 'FILLED');
    assert.equal(incoming.price, '1.00');
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: BigInt(incoming.id) } });
    assert.equal(saved.side, 'CASH_IN');
    assert.equal(saved.size, 100);
    const outgoing = await submit(id, { instrumentId: 66, side: OrderSide.CASH_OUT, type: OrderType.MARKET, amount: '40.00' });
    assert.equal(outgoing.status, 'FILLED');
    assert.equal(outgoing.size, 40);
    const result = await portfolio(id);
    assert.equal(result.availableCash, '60.00');
    assert.equal(result.totalValue, '60.00');
    assert.equal(present(result.positions.find(p => p.ticker === 'ARS')).marketValue, '60.00');
  });

  void test('CASH_OUT cannot consume reserved funds; rejection is persisted', async () => {
    const id = await user(100);
    await submit(id, { ...market, type: OrderType.LIMIT, size: 1, price: '80.00' });
    const rejected = await submit(id, { ...transfer, side: OrderSide.CASH_OUT, size: 21 });
    assert.equal(rejected.status, 'REJECTED');
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: BigInt(rejected.id) } })).status, 'REJECTED');
    assert.equal((await portfolio(id)).availableCash, '20.00');
    assert.equal((await submit(id, { ...transfer, side: OrderSide.CASH_OUT, size: 20 })).status, 'FILLED');
    assert.equal((await portfolio(id)).availableCash, '0.00');
  });

  void test('transfers reject fractional pesos, LIMIT, a custom price and non-ARS instruments', async () => {
    const id = await user();
    const initial = await prisma.order.count({ where: { userId: id } });
    for (const body of [
      { ...transfer, size: 0 }, { ...transfer, size: -1 }, { ...transfer, size: 0.5 },
      { ...transfer, type: OrderType.LIMIT, price: '1.00' }, { ...transfer, price: '1.00' },
      { ...transfer, instrumentId: 1 }, { ...transfer, size: undefined, amount: '1.50' },
      { ...transfer, size: undefined, amount: '2147483648.00' },
    ]) await submit(id, body, 400);
    assert.equal(await prisma.order.count({ where: { userId: id } }), initial);
  });

  void test('a BUY amount exceeding available funds is REJECTED even if rounded share cost fits', async () => {
    const id = await user(100);
    const result = await submit(id, { instrumentId: 1, side: OrderSide.BUY, type: OrderType.LIMIT, amount: '110.00', price: '60.00' });
    assert.equal(result.size, 1);
    assert.equal(result.status, 'REJECTED');
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: BigInt(result.id) } })).status, 'REJECTED');
    assert.equal((await portfolio(id)).availableCash, '100.00');
  });
});

void describe('HTTP: cancellation and ownership', () => {
  void test('cancelling NEW BUY releases reserved cash and keeps the order history', async () => {
    const id = await user(100);
    const pending = await submit(id, { ...market, size: 1, type: OrderType.LIMIT, price: '80.00' });
    assert.equal((await portfolio(id)).availableCash, '20.00');
    assert.deepEqual(await cancel(id, pending.id), { id: pending.id, userId: id.toString(), status: OrderStatus.CANCELLED });
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: BigInt(pending.id) } })).status, 'CANCELLED');
    const result = await portfolio(id);
    assert.equal(result.availableCash, '100.00');
    assert.equal(result.reservedCash, '0.00');
    assert.equal(result.totalValue, '100.00');
    assert.equal((await submit(id, { ...transfer, side: OrderSide.CASH_OUT, size: 100 })).status, 'FILLED');
  });

  void test('cancelling NEW SELL releases shares and preserves holdings and cost', async () => {
    const id = await user();
    await submit(id, market);
    const pending = await submit(id, { ...market, side: OrderSide.SELL, type: OrderType.LIMIT, price: '300.00' });
    const before = (await portfolio(id)).positions.find(p => p.ticker === 'DYCA');
    assert.ok(before);
    assert.equal(before.availableQuantity, 0);
    await cancel(id, pending.id);
    const after = (await portfolio(id)).positions.find(p => p.ticker === 'DYCA');
    assert.ok(after);
    assert.equal(after.availableQuantity, 2);
    assert.equal(after.quantity, before.quantity);
    assert.equal(after.totalReturnPercent, before.totalReturnPercent);
    assert.equal((await submit(id, { ...market, side: OrderSide.SELL })).status, 'FILLED');
  });

  void test('FILLED, REJECTED and CANCELLED orders cannot be cancelled', async () => {
    const id = await user();
    const filled = await submit(id, { ...market, size: 1 });
    const rejected = await submit(id, { ...market, size: 100 });
    const pending = await submit(id, { ...market, size: 1, type: OrderType.LIMIT, price: '1.00' });
    await cancel(id, pending.id);
    for (const order of [filled, rejected, { ...pending, status: OrderStatus.CANCELLED }]) {
      await cancel(id, order.id, 409);
      assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: BigInt(order.id) } })).status, order.status);
    }
  });

  void test('cancellation enforces ownership and rejects nonexistent or invalid identifiers', async () => {
    const owner = await user();
    const other = await user();
    const pending = await submit(owner, { ...market, type: OrderType.LIMIT, price: '1.00' });
    await cancel(other, pending.id, 404);
    await cancel(owner, 2147483647, 404);
    await cancel(2147483647, pending.id, 404);
    for (const orderId of ['abc', 1.5]) await cancel(owner, orderId, 400);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: BigInt(pending.id) } })).status, 'NEW');
  });
});

void describe('HTTP: concurrent resource usage', () => {
  void test('concurrent MARKET buys and LIMIT reservations cannot spend the same cash twice', async () => {
    for (const type of ['MARKET', 'LIMIT']) {
      const id = await user(300);
      const body = { ...market, size: 1, type, ...(type === 'LIMIT' ? { price: '259.00' } : {}) };
      const results = await Promise.all([submit(id, body), submit(id, body)]);
      assert.deepEqual(results.map(o => o.status).sort(), [type === 'MARKET' ? 'FILLED' : 'NEW', 'REJECTED'].sort());
      assert.equal((await portfolio(id)).availableCash, '41.00');
    }
  });

  void test('concurrent sells cannot sell the same shares twice', async () => {
    const id = await user();
    await submit(id, { ...market, size: 1 });
    const results = await Promise.all([submit(id, { ...market, side: OrderSide.SELL, size: 1 }), submit(id, { ...market, side: OrderSide.SELL, size: 1 })]);
    assert.deepEqual(results.map(o => o.status).sort(), ['FILLED', 'REJECTED']);
    const result = await portfolio(id);
    assert.equal(result.availableCash, '1000.00');
    assert.equal(result.positions.some(position => position.ticker === 'DYCA'), false);
  });

  void test('concurrent withdrawals and purchases share the same account lock', async () => {
    const withdrawals = await user(100);
    const results = await Promise.all([
      submit(withdrawals, { ...transfer, side: OrderSide.CASH_OUT, size: 80 }),
      submit(withdrawals, { ...transfer, side: OrderSide.CASH_OUT, size: 80 }),
    ]);
    assert.deepEqual(results.map(o => o.status).sort(), ['FILLED', 'REJECTED']);
    assert.equal((await portfolio(withdrawals)).availableCash, '20.00');
    const mixed = await user(300);
    const mixedResults = await Promise.all([
      submit(mixed, { ...transfer, side: OrderSide.CASH_OUT, size: 259 }),
      submit(mixed, { ...market, size: 1 }),
    ]);
    assert.deepEqual(mixedResults.map(o => o.status).sort(), ['FILLED', 'REJECTED']);
    assert.equal((await portfolio(mixed)).availableCash, '41.00');
  });

  void test('two cancellations only release the reservation once', async () => {
    const id = await user(100);
    const pending = await submit(id, { ...market, size: 1, type: OrderType.LIMIT, price: '80.00' });
    const responses = await Promise.all([1, 2].map(() => fetch(`${url}/users/${id}/orders/${pending.id}/cancel`, { method: 'POST' })));
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    assert.equal((await portfolio(id)).availableCash, '100.00');
  });
});

void describe('HTTP: bigint identifiers and portfolio valuation', () => {
  void test('IDs above the JS safe-integer limit survive searches, orders, portfolios and cancellation', async () => {
    const id = 9007199254740993n;
    for (const userId of [id - 1n, id]) {
      await prisma.user.create({ data: { id: userId, email: `bigid-${userId}@test.local`, accountNumber: `acc-${userId}`.slice(0, 20) } });
      createdUsers.push(userId);
    }
    await prisma.instrument.create({ data: { id, ticker: 'BIGIDTEST', name: 'Bigint test', type: InstrumentType.ACCIONES } });
    createdInstruments.push(id);
    await prisma.marketData.create({ data: { id, instrumentId: id, close: '10', previousClose: '9', date: new Date('2026-01-01') } });
    await submit(id, { ...transfer, instrumentId: '66' });
    const buy = await submit(id, { ...market, instrumentId: id.toString() });
    assert.equal(buy.userId, id.toString());
    assert.equal(buy.instrumentId, id.toString());
    const result = await portfolio(id);
    assert.equal(result.userId, id.toString());
    assert.equal(present(result.positions.find(p => p.ticker === 'BIGIDTEST')).instrumentId, id.toString());
    assert.equal(result.availableCash, '80.00');
    assert.equal((await portfolio(id - 1n)).availableCash, '0.00');
    const search = instrumentPage.parse(await (await fetch(`${url}/instruments?query=BIGIDTEST`)).json());
    assert.equal(search.items[0].id, id.toString());
    const pending = await submit(id, { ...market, instrumentId: id.toString(), type: OrderType.LIMIT, price: '10', size: 1 });
    await prisma.order.update({ where: { id: BigInt(pending.id) }, data: { id } });
    await cancel(id - 1n, id, 404);
    assert.deepEqual(await cancel(id, id), { id: id.toString(), userId: id.toString(), status: OrderStatus.CANCELLED });
  });

  void test('fresh quotes revalue the portfolio without changing the stored snapshot', async () => {
    const id = await user(100);
    const instrument = await prisma.instrument.create({ data: { ticker: 'SNAPQUOTE', name: 'Snapshot quote test', type: InstrumentType.ACCIONES } });
    createdInstruments.push(instrument.id);
    const quote = await prisma.marketData.create({ data: { instrumentId: instrument.id, close: '10', previousClose: '10', date: new Date('2026-01-01') } });
    await submit(id, { ...market, instrumentId: instrument.id.toString() });
    const stored = await prisma.accountSnapshot.findUniqueOrThrow({ where: { userId: id } });
    await prisma.marketData.update({ where: { id: quote.id }, data: { close: '20' } });
    const result = await portfolio(id);
    assert.equal(result.totalValue, '120.00');
    assert.equal(present(result.positions.find(p => p.ticker === 'SNAPQUOTE')).dailyReturnPercent, '100.00');
    assert.deepEqual(await prisma.accountSnapshot.findUniqueOrThrow({ where: { userId: id } }), stored);
  });

  void test('portfolio distinguishes total and daily return in ARS after a MARKET sale by amount', async () => {
    const id = await user(1000);
    const instrument = await prisma.instrument.create({ data: { ticker: 'RETURNS', name: 'Returns functional test', type: InstrumentType.ACCIONES } });
    createdInstruments.push(instrument.id);
    await prisma.marketData.create({ data: { instrumentId: instrument.id, close: '10', previousClose: '8', date: new Date('2026-01-01') } });
    const buy = await submit(id, { ...market, instrumentId: instrument.id.toString(), size: 10 });
    assert.equal(buy.price, '10.00');
    await prisma.marketData.create({ data: { instrumentId: instrument.id, close: '20', previousClose: '16', date: new Date('2026-01-02') } });
    const sale = await submit(id, { instrumentId: instrument.id.toString(), side: OrderSide.SELL, type: OrderType.MARKET, amount: '31.00' });
    assert.equal(sale.status, 'FILLED');
    assert.equal(sale.price, '20.00');
    assert.equal(sale.size, 1);
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: BigInt(sale.id) } });
    assert.equal(saved.side, 'SELL');
    assert.equal(saved.size, 1);
    assert.equal(saved.price.toFixed(2), '20.00');
    const result = await portfolio(id);
    assert.equal(result.currency, 'ARS');
    assert.equal(result.cashBalance, '920.00');
    assert.equal(result.availableCash, '920.00');
    assert.equal(result.totalValue, '1100.00');
    const stock = result.positions.find(position => position.ticker === 'RETURNS');
    assert.ok(stock);
    assert.equal(stock.quantity, 9);
    assert.equal(stock.marketValue, '180.00');
    assert.equal(stock.totalReturnPercent, '100.00');
    assert.equal(stock.dailyReturnPercent, '25.00');
    assert.equal(stock.priceDate, '2026-01-02');
    const cash = result.positions.find(position => position.ticker === 'ARS');
    assert.ok(cash);
    assert.equal(cash.type, 'MONEDA');
    assert.equal(cash.marketValue, '920.00');
  });
});

void describe('PostgreSQL integration: snapshots, reconstruction and atomicity', () => {
  void test('order pricing uses the active transaction and order changes roll back', async t => {
    const id = await user(1000);
    const instrument = await prisma.instrument.create({ data: { ticker: 'TXQUOTE', name: 'Transaction quote fixture', type: InstrumentType.ACCIONES } });
    createdInstruments.push(instrument.id);
    await prisma.marketData.create({ data: { instrumentId: instrument.id, close: '20', date: new Date('2026-01-01') } });
    const instruments = { ...prisma.instrument };
    t.mock.property(prisma, 'instrument', instruments);
    t.mock.method(instruments, 'findUnique', () => assert.fail('Instrument lookup must use the transaction client'));
    const persistedOrders = new PrismaOrderRepository(prisma);
    const transactionId = randomUUID();
    const orders: OrderRepository = {
      withUserLock(userId, work) {
        return persistedOrders.withUserLock(userId, async transaction => {
          await work(transaction);
          const saved = present(await transaction.findByTransactionId(transactionId));
          assert.equal(saved.order.price, '20.00');
          assert.equal(present(await transaction.readSnapshot()).settledCash, '960');
          throw new Error('Rollback order');
        });
      },
    };
    const useCase = new SubmitOrderUseCase(orders);
    await assert.rejects(useCase.execute(id, { ...market, instrumentId: instrument.id, transactionId }), /Rollback order/);
    assert.equal(await prisma.order.findUnique({ where: { transactionId } }), null);
    assert.equal(await prisma.accountSnapshot.findUnique({ where: { userId: id } }), null);
  });

  void test('persisted snapshots match reconstruction after fills, reservations, rejections and cancellations', async () => {
    const id = await user(1000);
    await submit(id, { ...market, size: 2 });
    await submit(id, { ...market, side: OrderSide.SELL, size: 1 });
    const pending = await submit(id, { ...market, type: OrderType.LIMIT, size: 1, price: '20' });
    await cancel(id, pending.id);
    await submit(id, { ...market, side: OrderSide.SELL, type: OrderType.LIMIT, size: 1, price: '300' });
    await submit(id, { ...transfer, side: OrderSide.CASH_OUT, size: 41 });
    const stored = await prisma.accountSnapshot.findUniqueOrThrow({ where: { userId: id } });
    assert.equal(stored.settledCash.toString(), '700');
    assert.equal(stored.reservedCash.toString(), '0');
    assert.deepEqual(stored.positions, [{ instrumentId: '1', quantity: 1, reservedQuantity: 1, cost: '259', inconsistent: false }]);
    await submit(id, { ...market, size: 100 });
    await portfolio(id);
    const unchanged = await prisma.accountSnapshot.findUniqueOrThrow({ where: { userId: id } });
    assert.deepEqual(unchanged, stored, 'Rejected orders and ordinary reads must not rewrite the snapshot');
    for (let repeat = 0; repeat < 2; repeat++) {
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
        await new PrismaAccountSnapshotRepository(tx).rebuild(id);
      });
      assert.deepEqual(snapshotState(await prisma.accountSnapshot.findUniqueOrThrow({ where: { userId: id } })), snapshotState(stored));
    }
  });

  void test('orders and snapshot changes roll back together on a failed transaction', async () => {
    const id = await user(100);
    await portfolio(id);
    const before = await prisma.accountSnapshot.findUniqueOrThrow({ where: { userId: id } });
    const ordersBefore = await prisma.order.count({ where: { userId: id } });
    const repository = new PrismaOrderRepository(prisma);
    await assert.rejects(repository.withUserLock(id, async transaction => {
      await transaction.save({ userId: id, instrumentId: 66n, side: OrderSide.CASH_OUT, type: OrderType.MARKET, status: OrderStatus.FILLED, size: 40, price: '1' }, randomUUID());
      throw new Error('Simulated transaction failure');
    }), /Simulated transaction failure/);
    assert.equal(await prisma.order.count({ where: { userId: id } }), ordersBefore);
    assert.deepEqual(await prisma.accountSnapshot.findUniqueOrThrow({ where: { userId: id } }), before);
  });

  void test('bootstrap reconstructs more than one ledger page; subsequent operations reuse the snapshot', async t => {
    const id = await user(0);
    await prisma.order.createMany({ data: Array.from({ length: 1005 }, (_, index) => ({ userId: id, instrumentId: 66n, side: OrderSide.CASH_IN, type: OrderType.MARKET, status: OrderStatus.FILLED, size: 1, price: '1', datetime: new Date(index % 2 ? '2023-01-01' : '2023-01-02') })) });
    const snapshots = new PrismaAccountSnapshotRepository(prisma);
    const portfolios = new PrismaPortfolioRepository(prisma, snapshots);
    const first = await portfolios.findByUserId(id);
    assert.ok(first);
    assert.equal(first.account.settledCash, '1005');
    t.mock.method(PrismaAccountSnapshotRepository.prototype, 'initialize', () => assert.fail('Existing snapshots must not be initialized again'));
    t.mock.method(PrismaAccountSnapshotRepository.prototype, 'rebuild', () => assert.fail('Existing snapshots must not be rebuilt'));
    // Prisma exposes $transaction dynamically, so intercept access rather than a property descriptor.
    const readOnlyClient = new Proxy(prisma, {
      get(target, property): unknown {
        if (property === '$transaction') return () => assert.fail('Reading an existing portfolio must not start a transaction');
        return Reflect.get(target, property);
      },
    });
    const existingPortfolios = new PrismaPortfolioRepository(readOnlyClient, snapshots);
    assert.equal(present(await existingPortfolios.findByUserId(id)).account.settledCash, '1005');
    await new PrismaOrderRepository(prisma).withUserLock(id, async transaction => {
      assert.equal(present(await transaction.readSnapshot()).settledCash, '1005');
      await transaction.save({ userId: id, instrumentId: 66n, side: OrderSide.CASH_OUT, type: OrderType.MARKET, status: OrderStatus.FILLED, size: 5, price: '1' }, randomUUID());
    });
    assert.equal(present(await existingPortfolios.findByUserId(id)).account.settledCash, '1000');
  });

  void test('a failed snapshot write rolls back order creation and cancellation', async t => {
    const id = await user(100);
    const pending = await submit(id, { ...market, size: 1, type: OrderType.LIMIT, price: '20' });
    const before = await prisma.accountSnapshot.findUniqueOrThrow({ where: { userId: id } });
    const count = await prisma.order.count({ where: { userId: id } });
    t.mock.method(PrismaAccountSnapshotRepository.prototype, 'save', () => { throw new Error('Snapshot write failed'); });
    const repository = new PrismaOrderRepository(prisma);
    await assert.rejects(repository.withUserLock(id, transaction => transaction.save({ userId: id, instrumentId: 66n, side: OrderSide.CASH_OUT, type: OrderType.MARKET, status: OrderStatus.FILLED, size: 10, price: '1' }, randomUUID())), /Snapshot write failed/);
    assert.equal(await prisma.order.count({ where: { userId: id } }), count);
    await assert.rejects(repository.withUserLock(id, transaction => transaction.cancel(BigInt(pending.id))), /Snapshot write failed/);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: BigInt(pending.id) } })).status, 'NEW');
    assert.deepEqual(await prisma.accountSnapshot.findUniqueOrThrow({ where: { userId: id } }), before);
  });

  void test('snapshot lookup is read-only and initialization is explicit and transactional', async () => {
    const id = await user(100);
    const repository = new PrismaOrderRepository(prisma);
    await repository.withUserLock(id, async transaction => {
      assert.equal(await transaction.readSnapshot(), null);
    });
    assert.equal(await prisma.accountSnapshot.count({ where: { userId: id } }), 0);
    await assert.rejects(repository.withUserLock(id, async transaction => {
      assert.equal((await transaction.initializeSnapshot()).settledCash, '100');
      throw new Error('Rollback initialization');
    }), /Rollback initialization/);
    assert.equal(await prisma.accountSnapshot.count({ where: { userId: id } }), 0);
    await repository.withUserLock(id, async transaction => {
      assert.equal((await transaction.initializeSnapshot()).settledCash, '100');
      assert.equal(present(await transaction.readSnapshot()).settledCash, '100');
    });
    assert.equal(await prisma.accountSnapshot.count({ where: { userId: id } }), 1);
  });
});

void describe('HTTP: idempotency and retries', () => {
  void test('simultaneous identical submissions create one order and return it for every retry', async () => {
    const id = await user(1000);
    const body = { ...market, transactionId: randomUUID() };
    const responses = await Promise.all(Array.from({ length: 8 }, () => fetch(`${url}/users/${id}/orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })));
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 200, 200, 200, 200, 200, 200, 201]);
    const created = orderResponse.parse(await present(responses.find(response => response.status === 201)).json());
    assert.equal(created.transactionId, body.transactionId);
    for (const response of responses.filter(response => response.status === 200)) {
      assert.deepEqual(await response.json(), created);
    }
    assert.equal(await prisma.order.count({ where: { userId: id, transactionId: body.transactionId } }), 1);
    assert.equal((await portfolio(id)).availableCash, '482.00');
  });

  void test('concurrent reuse with different details returns 409 and only one order wins', async () => {
    const id = await user(1000);
    const transactionId = randomUUID();
    const responses = await Promise.all([1, 2].map(size => fetch(`${url}/users/${id}/orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...market, size, transactionId }),
    })));
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
    assert.equal(await prisma.order.count({ where: { userId: id, transactionId } }), 1);
  });

  void test('equivalent requests replay while different payloads and users conflict', async () => {
    const id = await user();
    const transactionId = randomUUID();
    const body = { ...market, type: OrderType.LIMIT, price: '10', transactionId };
    const first = await submit(id, body);
    assert.deepEqual(await submit(id, { ...body, instrumentId: '1', price: 10.00 }, 200), first);
    for (const change of [{ instrumentId: 3 }, { side: OrderSide.SELL }, { size: 1 }, { price: '11' }, { size: undefined, amount: '20' }, { type: OrderType.MARKET, price: undefined }]) {
      await submit(id, { ...body, ...change }, 409);
    }
    const other = await user();
    await submit(other, body, 409);
    assert.equal((await submit(id, { ...body, transactionId: randomUUID() })).status, 'NEW');
  });

  void test('transfer retries credit or debit once and rejected orders stay rejected after funding', async () => {
    const id = await user(0);
    for (const side of ['CASH_IN', 'CASH_OUT']) {
      const body = { ...transfer, side, transactionId: randomUUID() };
      await submit(id, body);
      await Promise.all([submit(id, body, 200), submit(id, body, 200)]);
      assert.equal((await portfolio(id)).availableCash, side === 'CASH_IN' ? '100.00' : '0.00');
    }
    const body = { ...market, transactionId: randomUUID() };
    const rejected = await submit(id, body);
    assert.equal(rejected.status, 'REJECTED');
    await submit(id, { ...transfer, size: 1000 });
    assert.deepEqual(await submit(id, body, 200), rejected);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: BigInt(rejected.id) } })).status, 'REJECTED');
    assert.equal((await portfolio(id)).availableCash, '1000.00');
  });

  void test('retrying a cancelled LIMIT does not recreate its reservation', async () => {
    const id = await user();
    const body = { ...market, type: OrderType.LIMIT, price: '10', transactionId: randomUUID() };
    const first = await submit(id, body);
    await cancel(id, first.id);
    assert.deepEqual(await submit(id, body, 200), { ...first, status: OrderStatus.CANCELLED });
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: BigInt(first.id) } })).status, 'CANCELLED');
    assert.equal((await portfolio(id)).reservedCash, '0.00');
  });

  void test('duplicate MARKET request returns the saved result despite changed or missing quotes', async () => {
    const id = await user();
    const instrument = await prisma.instrument.create({ data: { ticker: 'IDEMQUOTE', name: 'Idempotency test', type: InstrumentType.ACCIONES } });
    createdInstruments.push(instrument.id);
    const quote = await prisma.marketData.create({ data: { instrumentId: instrument.id, close: '10', date: new Date() } });
    const body = { instrumentId: instrument.id.toString(), side: OrderSide.BUY, type: OrderType.MARKET, amount: '100', transactionId: randomUUID() };
    const first = await submit(id, body);
    await prisma.marketData.update({ where: { id: quote.id }, data: { close: '20' } });
    assert.deepEqual(await submit(id, { ...body, amount: '100.00' }, 200), first);
    await submit(id, { ...body, amount: '101' }, 409);
    await prisma.marketData.delete({ where: { id: quote.id } });
    assert.deepEqual(await submit(id, body, 200), first);
    assert.equal(await prisma.order.count({ where: { id: BigInt(first.id) } }), 1);
  });

  void test('missing or invalid transaction IDs fail before saving', async () => {
    const id = await user();
    const before = await prisma.order.count({ where: { userId: id } });
    for (const transactionId of [undefined, null, '', '   ', 123, 'a'.repeat(101)]) {
      await submit(id, { ...market, transactionId }, 400);
    }
    assert.equal(await prisma.order.count({ where: { userId: id } }), before);
  });

  void test('simultaneous requests from different users cannot reuse a global transaction ID', async () => {
    const users = [await user(), await user()];
    const transactionId = randomUUID();
    const responses = await Promise.all(users.map(id => fetch(`${url}/users/${id}/orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...market, transactionId }),
    })));
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
    assert.equal(await prisma.order.count({ where: { transactionId } }), 1);
    const balances = await Promise.all(users.map(async id => (await portfolio(id)).availableCash));
    assert.deepEqual(balances.sort(), ['1000.00', '482.00']);
  });

  void test('legacy orders without original request data conflict instead of guessing equivalence', async () => {
    const id = await user();
    const body = { ...market, transactionId: randomUUID() };
    const first = await submit(id, body);
    await prisma.order.update({ where: { id: BigInt(first.id) }, data: { originalRequest: null } });
    await submit(id, body, 409);
    assert.equal((await portfolio(id)).availableCash, '482.00');
  });
});

void describe('PostgreSQL integration: uniqueness, rollback and forced races', () => {
  void test('database uniqueness rejects duplicate keys even when the API is bypassed', async () => {
    const id = await user();
    const transactionId = randomUUID();
    await submit(id, { ...market, transactionId });
    const saved = await prisma.order.findFirstOrThrow({ where: { userId: id, transactionId } });
    const { id: orderId, ...data } = saved;
    assert.ok(orderId);
    await assert.rejects(prisma.order.create({ data }), error => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002');
  });

  void test('a rolled-back submission does not consume its transaction ID', async t => {
    const id = await user(100);
    await portfolio(id);
    const before = await prisma.accountSnapshot.findUniqueOrThrow({ where: { userId: id } });
    const body = { ...transfer, size: 50, transactionId: randomUUID() };
    const save = t.mock.method(PrismaAccountSnapshotRepository.prototype, 'save', () => { throw new Error('Snapshot write failed'); });
    const useCase = new SubmitOrderUseCase(new PrismaOrderRepository(prisma));
    await assert.rejects(useCase.execute(id, body), /Snapshot write failed/);
    assert.equal(await prisma.order.count({ where: { userId: id, transactionId: body.transactionId } }), 0);
    assert.deepEqual(await prisma.accountSnapshot.findUniqueOrThrow({ where: { userId: id } }), before);
    save.mock.restore();
    await submit(id, body);
    await submit(id, body, 200);
    assert.equal((await portfolio(id)).availableCash, '150.00');
  });

  void test('a global unique violation after simultaneous lookups becomes a conflict and rolls back', async () => {
    const users = [await user(), await user()];
    await Promise.all(users.map(portfolio));
    const transactionId = randomUUID();
    let reads = 0;
    let release: () => void = () => assert.fail('Barrier was not initialized');
    const ready = new Promise<void>(resolve => { release = resolve; });
    const persistedOrders = new PrismaOrderRepository(prisma);
    const racingOrders: OrderRepository = {
      withUserLock(userId, work) {
        return persistedOrders.withUserLock(userId, transaction => work({
          ...transaction,
          async findByTransactionId(key) {
            const result = await transaction.findByTransactionId(key);
            if (key === transactionId) {
              assert.equal(result, null);
              if (++reads === 2) release();
              await ready;
            }
            return result;
          },
        }));
      },
    };
    const useCase = new SubmitOrderUseCase(racingOrders);
    const results = await Promise.allSettled(users.map(id => useCase.execute(id, { ...market, transactionId })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const failure: unknown = present(results.find(r => r.status === 'rejected')).reason;
    assert.ok(failure instanceof Error);
    assert.equal(failure.constructor.name, 'OrderIdempotencyConflictError', failure.message);
    assert.equal(await prisma.order.count({ where: { transactionId } }), 1);
    const balances = await Promise.all(users.map(async id => (await portfolio(id)).availableCash));
    assert.deepEqual(balances.sort(), ['1000.00', '482.00']);
  });
});
