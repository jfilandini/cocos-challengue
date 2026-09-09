import { validateIdInput } from '../../shared/domain/database-validator-helper';
import { InstrumentType } from '../../shared/domain/instrument-type';
import { Currency } from '../../shared/domain/currency';
import { isCashTransfer, isInstrumentOrder } from '../../shared/domain/order-side';
import { generateOrderDraft, InvalidOrderError, OrderResourceNotFoundError } from '../domain/order';
import { OrderIdempotencyConflictError } from './order-idempotency';
import { validateOrder, validateOrderSize } from './order.schema';
import type { OrderRepository } from './ports/order.repository';

export class SubmitOrderUseCase {
  constructor(private readonly orders: OrderRepository) {}

  execute(userIdInput: unknown, body: unknown) {
    const userId = validateIdInput(userIdInput);
    const request = validateOrder(body);
    return this.orders.withUserLock(userId, async transaction => {
      if (await transaction.existsByTransactionId(request.transactionId)) {
        throw new OrderIdempotencyConflictError('transactionId already exists');
      }
      const instrument = await transaction.findInstrument(request.instrumentId);
      if (!instrument) throw new OrderResourceNotFoundError('Instrument not found');
      if (isCashTransfer(request.side)) {
        if (instrument.type !== InstrumentType.MONEDA || instrument.ticker !== Currency.ARS) {
          throw new InvalidOrderError('Cash transfers require the ARS currency instrument');
        }
      } else if (isInstrumentOrder(request.side) && instrument.type !== InstrumentType.ACCIONES) {
        throw new InvalidOrderError('BUY/SELL requires a stock instrument');
      }
      const snapshot = await transaction.readSnapshot() ?? await transaction.initializeSnapshot();
      const draft = generateOrderDraft(userId, request, instrument.close, snapshot);
      validateOrderSize(draft.size);
      return transaction.save(draft, request.transactionId);
    });
  }
}
