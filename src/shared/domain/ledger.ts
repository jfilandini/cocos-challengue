import Decimal from 'decimal.js';
import { OrderSide } from './order-side';
import { OrderStatus } from './order-status';
import { OrderType } from './order-type';

const Amount = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export interface LedgerMovement {
  instrumentId: bigint;
  size: number;
  price: string;
  side: OrderSide;
  status: OrderStatus.FILLED | OrderStatus.NEW;
  type: OrderType;
}

export class PortfolioDataError extends Error {}

export function calculateLedger(movements: LedgerMovement[]) {
  let cash = new Amount(0);
  let reservedCash = new Amount(0);
  const positions = new Map<bigint, { quantity: number; cost: Decimal; inconsistent: boolean }>();
  const reservedShares = new Map<bigint, number>();

  for (const order of movements) {
    if (!Number.isSafeInteger(order.size) || order.size <= 0 || !new Amount(order.price).gt(0)) {
      throw new PortfolioDataError('Invalid movement quantity or price');
    }
    const value = new Amount(order.price).mul(order.size);
    if (order.status === OrderStatus.NEW) {
      if (order.type !== OrderType.LIMIT || ![OrderSide.BUY, OrderSide.SELL].includes(order.side)) {
        throw new PortfolioDataError('Invalid pending order');
      }
      if (order.side === OrderSide.BUY) reservedCash = reservedCash.plus(value);
      else reservedShares.set(order.instrumentId, (reservedShares.get(order.instrumentId) ?? 0) + order.size);
      continue;
    }
    if (order.side === OrderSide.CASH_IN || order.side === OrderSide.CASH_OUT) {
      cash = cash.plus(order.side === OrderSide.CASH_IN ? order.size : -order.size);
      continue;
    }
    const position = positions.get(order.instrumentId) ?? { quantity: 0, cost: new Amount(0), inconsistent: false };
    if (order.side === OrderSide.BUY) {
      cash = cash.minus(value);
      position.quantity += order.size;
      position.cost = position.cost.plus(value);
    } else {
      cash = cash.plus(value);
      if (order.size > position.quantity) position.inconsistent = true;
      if (position.quantity > 0) {
        position.cost = position.cost.minus(position.cost.div(position.quantity).mul(order.size));
      }
      position.quantity -= order.size;
    }
    if (position.quantity === 0) {
      position.cost = new Amount(0);
      position.inconsistent = false;
    }
    positions.set(order.instrumentId, position);
  }

  return { cash, reservedCash, positions, reservedShares };
}
