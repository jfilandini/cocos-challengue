import { rebuildSnapshot } from '../../dist/snapshot/domain/account-snapshot.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateOrderDraft, InvalidOrderError } from '../../dist/orders/domain/order.js';
import { validateOrder as parseOrder, validateOrderSize } from '../../dist/orders/application/order.schema.js';
import { OrderSide } from '../../dist/shared/domain/order-side.js';
import { OrderStatus } from '../../dist/shared/domain/order-status.js';
import { OrderType } from '../../dist/shared/domain/order-type.js';

const validateOrder = body => parseOrder(body && typeof body === 'object' && !Array.isArray(body) ? { transactionId: 'unit-order', ...body } : body);

const buy = { instrumentId: 1n, side: OrderSide.BUY, type: OrderType.MARKET, size: 1 };
const deposit = { instrumentId: 66n, side: OrderSide.CASH_IN, type: OrderType.MARKET, status: OrderStatus.FILLED, size: 1, price: '1.00' };

test('decimal affordability is exact and amount leaves the unspent remainder available', () => {
  const request = validateOrder({ instrumentId: 1n, side: OrderSide.BUY, type: OrderType.MARKET, amount: '1.00' });
  const result = generateOrderDraft(1n, request, '0.10', rebuildSnapshot([deposit]));
  assert.equal(result.size, 10);
  assert.equal(result.status, OrderStatus.FILLED);
  const remainder = generateOrderDraft(1n, request, '0.30', rebuildSnapshot([deposit]));
  assert.equal(remainder.size, 3);
  assert.equal(remainder.status, OrderStatus.FILLED);
});

test('LIMIT rejection uses its specified price even without a quote', () => {
  const request = validateOrder({ ...buy, type: OrderType.LIMIT, price: '1.01' });
  assert.equal(generateOrderDraft(1n, request, null, rebuildSnapshot([deposit])).status, OrderStatus.REJECTED);
});

test('SELL by amount floors the quantity at market price', () => {
  const holding = { ...deposit, instrumentId: 1n, side: OrderSide.BUY, size: 3, price: '0.10' };
  const request = validateOrder({ instrumentId: 1n, side: OrderSide.SELL, type: OrderType.MARKET, amount: '0.29' });
  const result = generateOrderDraft(1n, request, '0.10', rebuildSnapshot([deposit, holding]));
  assert.equal(result.size, 2);
  assert.equal(result.status, OrderStatus.FILLED);
});

test('quantity bounds and invalid monetary input are rejected before persistence', () => {
  for (const price of ['Infinity', 'NaN', 'abc', '', '-1', 0, null]) {
    assert.throws(() => validateOrder({ ...buy, type: OrderType.LIMIT, price }), InvalidOrderError);
  }
  assert.equal(validateOrder({ ...buy, size: 2147483647 }).size, 2147483647);
  assert.throws(() => validateOrder({ ...buy, size: 2147483648 }), /Order size must be at most 2147483647/);
  const request = validateOrder({ instrumentId: 1n, side: OrderSide.BUY, type: OrderType.MARKET, amount: '2147483648.00' });
  const draft = generateOrderDraft(1n, request, '1.00', rebuildSnapshot([deposit]));
  assert.throws(() => validateOrderSize(draft.size), /Order size must be at most 2147483647/);
});


test('order schema normalizes money and IDs while accepting every supported order variant', () => {
  for (const side of Object.values(OrderSide)) {
    for (const quantity of [{ size: 2 }, { amount: '2' }]) {
      const result = validateOrder({ instrumentId: '9007199254740993', side, type: OrderType.MARKET, ...quantity });
      assert.equal(result.instrumentId, 9007199254740993n);
      if (quantity.amount) assert.equal(result.amount, '2.00');
    }
  }
  for (const side of [OrderSide.BUY, OrderSide.SELL]) {
    const result = validateOrder({ ...buy, side, type: OrderType.LIMIT, price: 12.5 });
    assert.equal(result.price, '12.50');
  }
});

test('order schema rejects conflicting fields, invalid types and fractional transfers', () => {
  const incoming = { instrumentId: '66', side: OrderSide.CASH_IN, type: OrderType.MARKET, amount: '1.50' };
  for (const body of [
    null, [], {}, { ...buy, instrumentId: null }, { ...buy, instrumentId: 'abc' },
    { ...buy, size: undefined }, { ...buy, amount: '10' }, { ...buy, size: '1' },
    { ...buy, size: 0 }, { ...buy, size: 1.5 }, { ...buy, side: 'OTHER' },
    { ...buy, type: 'OTHER' }, { ...buy, status: 'FILLED' },
    { ...buy, price: '1' }, { ...buy, price: null }, { ...buy, type: OrderType.LIMIT },
    { ...buy, type: OrderType.LIMIT, price: '1.001' }, incoming,
    { ...incoming, side: OrderSide.CASH_OUT },
    { ...incoming, amount: 'abc' }, { ...incoming, amount: '1.001' },
    { ...incoming, amount: '1', type: OrderType.LIMIT, price: '1' },
  ]) assert.throws(() => validateOrder(body), InvalidOrderError);
});
