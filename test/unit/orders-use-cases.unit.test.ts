import { instrumentRepository, orderTransaction } from '../support/ports.js';
import type { OrderRepository, OrderTransaction } from '../../src/orders/application/ports/order.repository.js';
import type { SubmittedOrder, CancelledOrder } from '../../src/orders/domain/order.js';
import { InstrumentType } from '../../src/shared/domain/instrument-type.js';
import { OrderStatus } from '../../src/shared/domain/order-status.js';
import { OrderType } from '../../src/shared/domain/order-type.js';
import { OrderSide } from '../../src/shared/domain/order-side.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SubmitOrderUseCase } from '../../src/orders/application/submit-order.use-case.js';
import { CancelOrderUseCase } from '../../src/orders/application/cancel-order.use-case.js';
import { serializeOrderRequest } from '../../src/orders/application/order-idempotency.js';
import { OrderCancellationError, OrderIdempotencyConflictError, OrderResourceNotFoundError } from '../../src/orders/domain/order.js';

const request = { transactionId: 'unit-order', instrumentId: 1n, side: OrderSide.BUY, type: OrderType.MARKET, size: 2 };
const snapshot = { settledCash: '100', reservedCash: '0', positions: [] };

function repository(overrides: Partial<OrderTransaction>): OrderRepository {
  const transaction = orderTransaction(overrides);
  return {
    withUserLock(userId, work) {
      assert.equal(userId, 1n);
      return work(transaction);
    },
  };
}

void test('submission initializes a missing snapshot and saves the calculated order with the original request', async () => {
  const useCase = new SubmitOrderUseCase(repository({
    async findByTransactionId() { return null; },
    async readSnapshot() { return null; },
    async initializeSnapshot() { return snapshot; },
    async save(draft, transactionId, originalRequest) {
      assert.deepEqual(draft, { userId: 1n, instrumentId: 1n, side: OrderSide.BUY, type: OrderType.MARKET, size: 2, price: '10.00', status: OrderStatus.FILLED });
      assert.equal(transactionId, request.transactionId);
      assert.equal(originalRequest, serializeOrderRequest(request));
      return { ...draft, id: 7n, transactionId, datetime: '2026-01-01T00:00:00.000Z' };
    },
  }), instrumentRepository({
    async findInstrumentById(id) {
      assert.equal(id, 1n);
      return { ticker: 'TEST', type: InstrumentType.ACCIONES, close: '10' };
    },
  }));
  const result = await useCase.execute('1', request);
  assert.equal(result.created, true);
  assert.equal(result.order.id, 7n);
});

void test('an equivalent retry returns the stored order without reading prices, initializing snapshots or saving', async () => {
  const stored: SubmittedOrder = { ...request, id: 7n, userId: 1n, status: OrderStatus.CANCELLED, price: '10.00', datetime: '2026-01-01T00:00:00.000Z' };
  const useCase = new SubmitOrderUseCase(repository({
    async findByTransactionId() { return { order: stored, originalRequest: serializeOrderRequest(request) }; },
    async readSnapshot() { assert.fail('Retries must not read snapshots'); },
    async initializeSnapshot() { assert.fail('Retries must not initialize snapshots'); },
    async save() { assert.fail('Retries must not save'); },
  }), instrumentRepository({
    async findInstrumentById() { assert.fail('Retries must not read current prices'); },
  }));
  assert.deepEqual(await useCase.execute('1', request), { order: stored, created: false });
  await assert.rejects(useCase.execute('1', { ...request, size: 3 }), OrderIdempotencyConflictError);
});

void test('quantity calculated from amount is validated before saving', async () => {
  const useCase = new SubmitOrderUseCase(repository({
    async findByTransactionId() { return null; },
    async readSnapshot() { return { ...snapshot, settledCash: '3000000000' }; },
    async save() { assert.fail('An overflowing quantity must not be persisted'); },
  }), instrumentRepository({
    async findInstrumentById() { return { ticker: 'TEST', type: InstrumentType.ACCIONES, close: '1' }; },
  }));
  await assert.rejects(useCase.execute('1', { ...request, size: undefined, amount: '2147483648.00' }), /Order size must be at most 2147483647/);
});

void test('cancellation resolves the order under the user lock and delegates a NEW order', async () => {
  const cancelled: CancelledOrder = { id: 7n, userId: 1n, status: OrderStatus.CANCELLED };
  const useCase = new CancelOrderUseCase(repository({
    async findOrder(id) { assert.equal(id, 7n); return { id, status: OrderStatus.NEW }; },
    async cancel(id) { assert.equal(id, 7n); return cancelled; },
  }));
  assert.deepEqual(await useCase.execute('1', '7'), cancelled);
});

void test('missing and non-NEW orders are rejected before invoking cancellation', async () => {
  for (const status of [null, OrderStatus.FILLED, OrderStatus.REJECTED, OrderStatus.CANCELLED]) {
    const useCase = new CancelOrderUseCase(repository({
      async findOrder() { return status === null ? null : { id: 7n, status }; },
      async cancel() { assert.fail('Ineligible orders must not reach cancellation'); },
    }));
    await assert.rejects(useCase.execute('1', '7'), status === null ? OrderResourceNotFoundError : OrderCancellationError);
  }
});
