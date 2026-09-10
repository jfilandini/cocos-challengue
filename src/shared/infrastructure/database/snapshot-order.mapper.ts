import { Currency } from '../../domain/currency';
import { InstrumentType } from '../../domain/instrument-type';
import { PortfolioDataError, type SnapshotOrder } from '../../domain/account-snapshot';
import { isCashTransfer, isOrderSide } from '../../domain/order-side';
import { isOrderStatus, OrderStatus } from '../../domain/order-status';
import { isOrderType } from '../../domain/order-type';
import type { Order } from '../../../generated/prisma/client';

type MovementRow = Order & { instrument: { ticker: string | null; type: string | null } };

export function toSnapshotOrder(order: MovementRow): SnapshotOrder {
  if (!isOrderSide(order.side) || !isOrderType(order.type) || !isOrderStatus(order.status) ||
      (order.status !== OrderStatus.FILLED && order.status !== OrderStatus.NEW)) {
    throw new PortfolioDataError(`Invalid movement ${order.id}`);
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
