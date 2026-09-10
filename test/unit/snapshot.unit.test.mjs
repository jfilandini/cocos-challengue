import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyOrder,
  cancelPendingOrder,
  emptySnapshot,
  rebuildSnapshot,
  PortfolioDataError,
} from '../../dist/snapshot/domain/account-snapshot.js';
import { toSnapshotOrder } from '../../dist/snapshot/infrastructure/persistence/snapshot-order.mapper.js';
import { OrderSide } from '../../dist/shared/domain/order-side.js';
import { OrderStatus } from '../../dist/shared/domain/order-status.js';
import { OrderType } from '../../dist/shared/domain/order-type.js';
import { InstrumentType } from '../../dist/shared/domain/instrument-type.js';
import { Currency } from '../../dist/shared/domain/currency.js';

test('emptySnapshot initializes empty positions with zero cash', () => {
  const snapshot = emptySnapshot();
  assert.equal(snapshot.settledCash, '0');
  assert.equal(snapshot.reservedCash, '0');
  assert.deepEqual(snapshot.positions, []);
});

test('applyOrder handles CASH_IN and CASH_OUT movements', () => {
  let snapshot = emptySnapshot();
  const cashIn = {
    instrumentId: 66n,
    size: 500,
    price: '1.00',
    side: OrderSide.CASH_IN,
    status: OrderStatus.FILLED,
    type: OrderType.MARKET,
  };
  snapshot = applyOrder(snapshot, cashIn);
  assert.equal(snapshot.settledCash, '500');

  const cashOut = {
    instrumentId: 66n,
    size: 200,
    price: '1.00',
    side: OrderSide.CASH_OUT,
    status: OrderStatus.FILLED,
    type: OrderType.MARKET,
  };
  snapshot = applyOrder(snapshot, cashOut);
  assert.equal(snapshot.settledCash, '300');
});

test('applyOrder ignores REJECTED and CANCELLED orders', () => {
  const snapshot = { settledCash: '100', reservedCash: '0', positions: [] };
  const rejected = {
    instrumentId: 1n,
    size: 10,
    price: '10.00',
    side: OrderSide.BUY,
    status: OrderStatus.REJECTED,
    type: OrderType.LIMIT,
  };
  assert.deepEqual(applyOrder(snapshot, rejected), snapshot);

  const cancelled = { ...rejected, status: OrderStatus.CANCELLED };
  assert.deepEqual(applyOrder(snapshot, cancelled), snapshot);
});

test('applyOrder and cancelPendingOrder handle cash and share reservations for NEW limit orders', () => {
  let snapshot = { settledCash: '1000', reservedCash: '0', positions: [{ instrumentId: '1', quantity: 10, reservedQuantity: 0, cost: '100', inconsistent: false }] };

  // Pending BUY reserves cash
  const pendingBuy = {
    instrumentId: 1n,
    size: 5,
    price: '20.00',
    side: OrderSide.BUY,
    status: OrderStatus.NEW,
    type: OrderType.LIMIT,
  };
  snapshot = applyOrder(snapshot, pendingBuy);
  assert.equal(snapshot.reservedCash, '100');

  // Cancelling pending BUY releases reserved cash
  snapshot = cancelPendingOrder(snapshot, pendingBuy);
  assert.equal(snapshot.reservedCash, '0');

  // Pending SELL reserves shares
  const pendingSell = {
    instrumentId: 1n,
    size: 4,
    price: '25.00',
    side: OrderSide.SELL,
    status: OrderStatus.NEW,
    type: OrderType.LIMIT,
  };
  snapshot = applyOrder(snapshot, pendingSell);
  assert.equal(snapshot.positions.find(p => p.instrumentId === '1')?.reservedQuantity, 4);

  // Cancelling pending SELL releases reserved shares
  snapshot = cancelPendingOrder(snapshot, pendingSell);
  assert.equal(snapshot.positions.find(p => p.instrumentId === '1')?.reservedQuantity, 0);
});

test('cancelPendingOrder throws PortfolioDataError for non-NEW orders', () => {
  const snapshot = emptySnapshot();
  const filled = {
    instrumentId: 1n,
    size: 5,
    price: '20.00',
    side: OrderSide.BUY,
    status: OrderStatus.FILLED,
    type: OrderType.LIMIT,
  };
  assert.throws(() => cancelPendingOrder(snapshot, filled), PortfolioDataError);
});

test('applyOrder throws PortfolioDataError on invalid order size or price', () => {
  const snapshot = emptySnapshot();
  const invalidSize = {
    instrumentId: 1n,
    size: -1,
    price: '10.00',
    side: OrderSide.BUY,
    status: OrderStatus.FILLED,
    type: OrderType.MARKET,
  };
  assert.throws(() => applyOrder(snapshot, invalidSize), PortfolioDataError);

  const invalidPrice = { ...invalidSize, size: 5, price: '0' };
  assert.throws(() => applyOrder(snapshot, invalidPrice), PortfolioDataError);
});

test('toSnapshotOrder maps valid Prisma order row to SnapshotOrder', () => {
  const row = {
    id: 10n,
    userId: 1n,
    instrumentId: 2n,
    side: OrderSide.BUY,
    type: OrderType.LIMIT,
    status: OrderStatus.FILLED,
    size: 10,
    price: 15.5,
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

test('toSnapshotOrder rejects invalid movements and instrument mismatches', () => {
  const base = {
    id: 10n,
    userId: 1n,
    instrumentId: 2n,
    side: OrderSide.BUY,
    type: OrderType.LIMIT,
    status: OrderStatus.FILLED,
    size: 10,
    price: 15.5,
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

test('rebuildSnapshot replays sequential orders to produce correct state', () => {
  const orders = [
    { instrumentId: 66n, size: 1000, price: '1.00', side: OrderSide.CASH_IN, status: OrderStatus.FILLED, type: OrderType.MARKET },
    { instrumentId: 1n, size: 10, price: '50.00', side: OrderSide.BUY, status: OrderStatus.FILLED, type: OrderType.LIMIT },
    { instrumentId: 1n, size: 4, price: '60.00', side: OrderSide.SELL, status: OrderStatus.FILLED, type: OrderType.LIMIT },
  ];
  const snapshot = rebuildSnapshot(orders);
  assert.equal(snapshot.settledCash, '740');
  assert.equal(snapshot.reservedCash, '0');
  assert.equal(snapshot.positions.length, 1);
  assert.equal(snapshot.positions[0].quantity, 6);
});

