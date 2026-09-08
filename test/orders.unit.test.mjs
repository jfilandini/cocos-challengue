import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideOrder, InvalidOrderError, validateOrder } from '../dist/orders/domain/order.js';
import { OrderSide } from '../dist/shared/domain/order-side.js';
import { OrderStatus } from '../dist/shared/domain/order-status.js';
import { OrderType } from '../dist/shared/domain/order-type.js';

const buy = { instrumentId: 1, side: OrderSide.BUY, type: OrderType.MARKET, size: 1 };
const deposit = { instrumentId: 66, side: OrderSide.CASH_IN, type: OrderType.MARKET, status: OrderStatus.FILLED, size: 1, price: '1.00' };

test('decimal affordability is exact and amount leaves the unspent remainder available', () => {
  const request = validateOrder(1, { instrumentId: 1, side: OrderSide.BUY, type: OrderType.MARKET, amount: '1.00' });
  const result = decideOrder(1, request, '0.10', [deposit]);
  assert.equal(result.size, 10);
  assert.equal(result.status, OrderStatus.FILLED);
  const remainder = decideOrder(1, request, '0.30', [deposit]);
  assert.equal(remainder.size, 3);
  assert.equal(remainder.status, OrderStatus.FILLED);
});

test('LIMIT rejection uses its specified price even without a quote', () => {
  const request = validateOrder(1, { ...buy, type: OrderType.LIMIT, price: '1.01' });
  assert.equal(decideOrder(1, request, null, [deposit]).status, OrderStatus.REJECTED);
});

test('SELL by amount floors the quantity at market price', () => {
  const holding = { ...deposit, instrumentId: 1, side: OrderSide.BUY, size: 3, price: '0.10' };
  const request = validateOrder(1, { instrumentId: 1, side: OrderSide.SELL, type: OrderType.MARKET, amount: '0.29' });
  const result = decideOrder(1, request, '0.10', [deposit, holding]);
  assert.equal(result.size, 2);
  assert.equal(result.status, OrderStatus.FILLED);
});

test('schema bounds and nonfinite monetary input are rejected before persistence', () => {
  for (const price of ['100000000.00', 'Infinity', 'NaN', 0, null]) {
    assert.throws(() => validateOrder(1, { ...buy, type: OrderType.LIMIT, price }), InvalidOrderError);
  }
  assert.throws(() => validateOrder(1, { ...buy, size: 2147483648 }), InvalidOrderError);
  const request = validateOrder(1, { instrumentId: 1, side: OrderSide.BUY, type: OrderType.MARKET, amount: '2147483648.00' });
  assert.throws(() => decideOrder(1, request, '1.00', [deposit]), InvalidOrderError);
});
