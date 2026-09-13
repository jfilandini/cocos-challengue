import { OrderStatus } from '../../src/shared/domain/order-status.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InvalidOrderError } from '../../src/orders/domain/order.js';
import { validateOrder, validateOrderSize } from '../../src/orders/application/order.schema.js';
import { OrderSide } from '../../src/shared/domain/order-side.js';
import { OrderType } from '../../src/shared/domain/order-type.js';

const buy = { transactionId: 'unit-order', instrumentId: 1n, side: OrderSide.BUY, type: OrderType.MARKET, size: 1 };

void test('order validation rejects lossy JSON instrument IDs instead of selecting another instrument', () => {
  const instrumentId: unknown = JSON.parse('9007199254740993');
  assert.throws(() => validateOrder({ ...buy, instrumentId }), InvalidOrderError);
  assert.equal(validateOrder({ ...buy, instrumentId: '9007199254740993' }).instrumentId, 9007199254740993n);
  assert.equal(validateOrder({ ...buy, instrumentId: 1 }).instrumentId, 1n);
  assert.throws(() => validateOrder({ ...buy, instrumentId: '9223372036854775808' }), InvalidOrderError);
  assert.throws(() => validateOrder({ ...buy, instrumentId: undefined }), InvalidOrderError);
});

void test('schema rejects invalid prices and quantities outside the supported integer range', () => {
  for (const price of ['Infinity', 'NaN', 'abc', '', '-1', 0, null]) {
    assert.throws(() => validateOrder({ ...buy, type: OrderType.LIMIT, price }), InvalidOrderError);
  }
  assert.equal(validateOrder({ ...buy, size: 2147483647 }).size, 2147483647);
  assert.throws(() => validateOrder({ ...buy, size: 2147483648 }), /Order size must be at most 2147483647/);
  assert.throws(() => validateOrderSize(2147483648), /Order size must be at most 2147483647/);
});

void test('order schema normalizes money and IDs while accepting every supported order variant', () => {
  for (const side of Object.values(OrderSide)) {
    for (const quantity of [{ size: 2 }, { amount: '2' }]) {
      const result = validateOrder({ transactionId: 'unit-order', instrumentId: '9007199254740993', side, type: OrderType.MARKET, ...quantity });
      assert.equal(result.instrumentId, 9007199254740993n);
      if (quantity.amount) assert.equal(result.amount, '2.00');
    }
  }
  for (const side of [OrderSide.BUY, OrderSide.SELL]) {
    const result = validateOrder({ ...buy, side, type: OrderType.LIMIT, price: 12.5 });
    assert.equal(result.price, '12.50');
  }
});

void test('order schema rejects conflicting fields, invalid types and fractional transfers', () => {
  const incoming = { transactionId: 'unit-order', instrumentId: '66', side: OrderSide.CASH_IN, type: OrderType.MARKET, amount: '1.50' };
  for (const body of [
    null, [], {}, { ...buy, instrumentId: null }, { ...buy, instrumentId: 'abc' },
    { ...buy, size: undefined }, { ...buy, amount: '10' }, { ...buy, size: '1' },
    { ...buy, size: 0 }, { ...buy, size: 1.5 }, { ...buy, side: 'OTHER' },
    { ...buy, type: 'OTHER' }, { ...buy, status: OrderStatus.FILLED },
    { ...buy, price: '1' }, { ...buy, price: null }, { ...buy, type: OrderType.LIMIT },
    { ...buy, type: OrderType.LIMIT, price: '1.001' }, incoming,
    { ...incoming, side: OrderSide.CASH_OUT },
    { ...incoming, amount: 'abc' }, { ...incoming, amount: '1.001' },
    { ...incoming, amount: '1', type: OrderType.LIMIT, price: '1' },
  ]) assert.throws(() => validateOrder(body), InvalidOrderError);
});
