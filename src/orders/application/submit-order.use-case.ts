import { validateIdInput } from '../../shared/domain/database-validator-helper';
import { InstrumentType } from '../../shared/domain/instrument-type';
import { Currency } from '../../shared/domain/currency';
import { isCashTransfer, isInstrumentOrder } from '../../shared/domain/order-side';
import { generateOrderDraft, InvalidOrderError, OrderIdempotencyConflictError, OrderResourceNotFoundError } from '../domain/order';
import { validateOrder, validateOrderSize } from './order.schema';
import type { OrderRepository } from './ports/order.repository';
import type { InstrumentRepository } from '../../instruments/application/ports/instrument.repository';
  
export class SubmitOrderUseCase {
  constructor(private readonly orders: OrderRepository,
    private readonly instruments: InstrumentRepository,) {}
  

  async execute(userIdInput: unknown, body: unknown) {
    const userId = validateIdInput(userIdInput);
    const request = validateOrder(body);
    const instrumentWithLatestClose = await this.instruments.findInstrumentById(request.instrumentId);
    if (!instrumentWithLatestClose) throw new OrderResourceNotFoundError('Instrument not found');
    return this.orders.withUserLock(userId, async transaction => {
      if (await transaction.existsByTransactionId(request.transactionId)) {
        throw new OrderIdempotencyConflictError('transactionId already exists');
      }

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
      return transaction.save(draft, request.transactionId);
    });
  }
}
