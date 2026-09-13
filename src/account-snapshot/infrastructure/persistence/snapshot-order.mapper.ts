import { Currency } from '../../../shared/domain/currency';
import { InstrumentType, isInstrumentType } from '../../../shared/domain/instrument-type';
import { PortfolioDataError, type SnapshotOrder } from '../../domain/account-snapshot';
import { isCashTransfer, isOrderSide } from '../../../shared/domain/order-side';
import { isOrderStatus, OrderStatus } from '../../../shared/domain/order-status';
import { isOrderType } from '../../../shared/domain/order-type';
import type { Order } from '../../../generated/prisma/client';

type MovementRow = Order & { instrument: { ticker: string; type: string } };

export function toSnapshotOrder(order: MovementRow): SnapshotOrder {
  if (!isOrderSide(order.side) || !isOrderType(order.type) || !isOrderStatus(order.status)) {
    throw new PortfolioDataError(`Invalid movement ${order.id}`);
  }
  if (order.status !== OrderStatus.FILLED && order.status !== OrderStatus.NEW) {
    throw new PortfolioDataError(`Invalid movement ${order.id}`);
  }
  if (!isInstrumentType(order.instrument.type)) {
    throw new PortfolioDataError(`Invalid instrument for movement ${order.id}`);
  }
  const cash = isCashTransfer(order.side);
  if (cash ? order.instrument.ticker !== Currency.ARS || order.instrument.type !== InstrumentType.MONEDA
    : order.instrument.type !== InstrumentType.ACCIONES) {
    throw new PortfolioDataError(`Invalid instrument for movement ${order.id}`);
  }
  return {
    instrumentId: order.instrumentId,
    size: order.size,
    price: order.price.toString(),
    side: order.side,
    type: order.type,
    status: order.status,
  };
}
