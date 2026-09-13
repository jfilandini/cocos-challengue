import { Prisma } from '../../src/generated/prisma/client.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toSnapshotOrder } from '../../src/account-snapshot/infrastructure/persistence/snapshot-order.mapper.js';
import { PortfolioDataError } from '../../src/account-snapshot/domain/account-snapshot.js';
import { OrderSide } from '../../src/shared/domain/order-side.js';
import { OrderStatus } from '../../src/shared/domain/order-status.js';
import { OrderType } from '../../src/shared/domain/order-type.js';
import { InstrumentType } from '../../src/shared/domain/instrument-type.js';
import { Currency } from '../../src/shared/domain/currency.js';

void test('toSnapshotOrder maps valid Prisma order row to SnapshotOrder', () => {
  const row = {
    id: 10n,
    userId: 1n,
    instrumentId: 2n,
    side: OrderSide.BUY,
    type: OrderType.LIMIT,
    status: OrderStatus.FILLED,
    size: 10,
    price: new Prisma.Decimal(15.5),
    originalRequest: null,
    datetime: new Date(),
    transactionId: 'tx-1',
    instrument: { ticker: 'GGAL', type: InstrumentType.ACCIONES },
  };
  const snapshotOrder = toSnapshotOrder(row);
  assert.deepEqual(snapshotOrder, {
    instrumentId: 2n,
    size: 10,
    price: '15.5',
    side: OrderSide.BUY,
    type: OrderType.LIMIT,
    status: OrderStatus.FILLED,
  });
});

void test('toSnapshotOrder rejects invalid movements and instrument mismatches', () => {
  const base = {
    id: 10n,
    userId: 1n,
    instrumentId: 2n,
    side: OrderSide.BUY,
    type: OrderType.LIMIT,
    status: OrderStatus.FILLED,
    size: 10,
    price: new Prisma.Decimal(15.5),
    originalRequest: null,
    datetime: new Date(),
    transactionId: null,
    instrument: { ticker: 'GGAL', type: InstrumentType.ACCIONES },
  };

  // Invalid status
  assert.throws(() => toSnapshotOrder({ ...base, status: OrderStatus.CANCELLED }), PortfolioDataError);

  // Cash movement with non-MONEDA type
  assert.throws(() => toSnapshotOrder({
    ...base,
    side: OrderSide.CASH_IN,
    instrument: { ticker: Currency.ARS, type: InstrumentType.ACCIONES },
  }), PortfolioDataError);

  // Cash movement with non-ARS ticker
  assert.throws(() => toSnapshotOrder({
    ...base,
    side: OrderSide.CASH_IN,
    instrument: { ticker: 'USD', type: InstrumentType.MONEDA },
  }), PortfolioDataError);
});
