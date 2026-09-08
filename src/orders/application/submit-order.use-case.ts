import { InstrumentType } from '../../shared/domain/instrument-type';
import { Currency } from '../../shared/domain/currency';
import { isCashTransfer } from '../../shared/domain/order-side';
import { decideOrder, InvalidOrderError, OrderResourceNotFoundError, validateOrder } from '../domain/order';
import type { OrderRepository } from './ports/order.repository';

export class SubmitOrderUseCase {
  constructor(private readonly orders: OrderRepository) {}

  execute(userId: number, body: unknown) {
    const request = validateOrder(userId, body);
    return this.orders.withUserLock(userId, async transaction => {
      const instrument = await transaction.findInstrument(request.instrumentId);
      if (!instrument) throw new OrderResourceNotFoundError('Instrument not found');
      if (isCashTransfer(request.side)) {
        if (instrument.type !== InstrumentType.MONEDA || instrument.ticker !== Currency.ARS) {
          throw new InvalidOrderError('Cash transfers require the ARS currency instrument');
        }
      } else if (instrument.type !== InstrumentType.ACCIONES) {
        throw new InvalidOrderError('BUY/SELL requires a stock instrument');
      }
      const movements = await transaction.readMovements();
      return transaction.save(decideOrder(userId, request, instrument.close, movements));
    });
  }
}
