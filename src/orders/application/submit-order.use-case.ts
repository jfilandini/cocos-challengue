import { serializeOrderRequest } from './order-request-serializer';
import { validateUserIdInput } from '../../shared/domain/id-validator-helper';
import { InstrumentType } from '../../shared/domain/instrument-type';
import { Currency } from '../../shared/domain/currency';
import { isCashTransfer, isInstrumentOrder } from '../../shared/domain/order-side';
import { generateOrderDraft, InvalidOrderError, OrderIdempotencyConflictError, OrderResourceNotFoundError } from '../domain/order';
import { validateOrder, validateOrderSize } from './order.schema';
import type { OrderRepository } from './ports/order.repository';

export class SubmitOrderUseCase {
  constructor(private readonly orders: OrderRepository) {}

  async execute(userIdInput: unknown, body: unknown) {
    const userId = validateUserIdInput(userIdInput);
    const request = validateOrder(body);
    const originalRequest = serializeOrderRequest(request);
    return this.orders.withUserLock(userId, async transaction => {
      const existing = await transaction.findByTransactionId(request.transactionId);
      if (existing) {
        if (existing.order.userId !== userId || existing.originalRequest !== originalRequest) {
          throw new OrderIdempotencyConflictError('transactionId already exists with a different user or request');
        }
        return { order: existing.order, created: false };
      }
      const instrumentWithLatestClose = await transaction.findInstrumentById(request.instrumentId);
      if (!instrumentWithLatestClose) throw new OrderResourceNotFoundError('Instrument not found');

      if (isCashTransfer(request.side)) {
        if (instrumentWithLatestClose.type !== InstrumentType.MONEDA || instrumentWithLatestClose.ticker !== Currency.ARS) {
          throw new InvalidOrderError('Cash transfers require the ARS currency instrument');
        }
      } else if (isInstrumentOrder(request.side) && instrumentWithLatestClose.type !== InstrumentType.ACCIONES) {
        throw new InvalidOrderError('BUY/SELL requires a stock instrument');
      }
      const snapshot = await transaction.readSnapshot() ?? await transaction.initializeSnapshot();
      const draft = generateOrderDraft(userId, request, instrumentWithLatestClose.close, snapshot);
      validateOrderSize(draft.size);
      return { order: await transaction.save(draft, request.transactionId, originalRequest), created: true };
    });
  }
}
