import { rebuildSnapshot } from '../../src/snapshot/domain/account-snapshot.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateOrderDraft } from '../../src/orders/domain/order.js';
import { OrderSide } from '../../src/shared/domain/order-side.js';
import { OrderStatus } from '../../src/shared/domain/order-status.js';
import { OrderType } from '../../src/shared/domain/order-type.js';

const buy = { instrumentId: 1n, side: OrderSide.BUY, type: OrderType.MARKET, size: 1 };
const deposit = { instrumentId: 66n, side: OrderSide.CASH_IN, type: OrderType.MARKET, status: OrderStatus.FILLED, size: 1, price: '1.00' };

void test('BUY by amount uses exact decimal arithmetic and floors the quantity', () => {
  const request = { instrumentId: 1n, side: OrderSide.BUY, type: OrderType.MARKET, amount: '1.00' };
  const result = generateOrderDraft(1n, request, '0.10', rebuildSnapshot([deposit]));
  assert.equal(result.size, 10);
  assert.equal(result.status, OrderStatus.FILLED);
  const remainder = generateOrderDraft(1n, request, '0.30', rebuildSnapshot([deposit]));
  assert.equal(remainder.size, 3);
  assert.equal(remainder.status, OrderStatus.FILLED);
});

void test('LIMIT rejection uses its specified price even without a quote', () => {
  const request = { ...buy, type: OrderType.LIMIT, price: '1.01' };
  assert.equal(generateOrderDraft(1n, request, null, rebuildSnapshot([deposit])).status, OrderStatus.REJECTED);
});

void test('SELL by amount floors the quantity at market price', () => {
  const holding = { ...deposit, instrumentId: 1n, side: OrderSide.BUY, size: 3, price: '0.10' };
  const request = { instrumentId: 1n, side: OrderSide.SELL, type: OrderType.MARKET, amount: '0.29' };
  const result = generateOrderDraft(1n, request, '0.10', rebuildSnapshot([deposit, holding]));
  assert.equal(result.size, 2);
  assert.equal(result.status, OrderStatus.FILLED);
});
