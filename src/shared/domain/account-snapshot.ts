import Decimal from 'decimal.js';
import { isCashTransfer, isInstrumentOrder, OrderSide } from './order-side';
import { OrderStatus } from './order-status';
import { OrderType } from './order-type';

const Amount = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export interface SnapshotOrder {
  instrumentId: bigint;
  size: number;
  price: string;
  side: OrderSide;
  status: OrderStatus;
  type: OrderType;
}

export interface SnapshotPosition {
  instrumentId: string;
  quantity: number;
  reservedQuantity: number;
  cost: string;
  inconsistent: boolean;
}

/** Derived account state. Orders remain the source of truth. Prices are read separately. */
export interface AccountSnapshot {
  settledCash: string;
  reservedCash: string;
  positions: SnapshotPosition[];
}

export class PortfolioDataError extends Error {}

export function emptySnapshot(): AccountSnapshot {
  return { settledCash: '0', reservedCash: '0', positions: [] };
}

function validateOrder(order: SnapshotOrder): void {
  if (!Number.isSafeInteger(order.size) || order.size <= 0 ||
      !new Amount(order.price).isFinite() || !new Amount(order.price).gt(0)) {
    throw new PortfolioDataError('Invalid order quantity or price');
  }
}

export function applyOrder(snapshot: AccountSnapshot, order: SnapshotOrder): AccountSnapshot {
  if (order.status === OrderStatus.REJECTED || order.status === OrderStatus.CANCELLED) return snapshot;
  validateOrder(order);
  if (order.status === OrderStatus.NEW) return changeReservation(snapshot, order, 1);
  if (isCashTransfer(order.side)) {
    return { ...snapshot, settledCash: new Amount(snapshot.settledCash).plus(order.side === OrderSide.CASH_IN ? order.size : -order.size).toString() };
  }

  const id = order.instrumentId.toString();
  const position = { ...(snapshot.positions.find(p => p.instrumentId === id) ?? {
    instrumentId: id, quantity: 0, reservedQuantity: 0, cost: '0', inconsistent: false,
  }) };
  const value = new Amount(order.price).mul(order.size);
  const buying = order.side === OrderSide.BUY;
  if (buying) {
    position.quantity += order.size;
    position.cost = new Amount(position.cost).plus(value).toString();
  } else {
    if (order.size > position.quantity) position.inconsistent = true;
    if (position.quantity > 0) {
      position.cost = new Amount(position.cost).mul(position.quantity - order.size).div(position.quantity).toString();
    }
    position.quantity -= order.size;
  }
  if (position.quantity === 0) {
    position.cost = '0';
    position.inconsistent = false;
  }
  return {
    ...snapshot,
    settledCash: new Amount(snapshot.settledCash).plus(buying ? value.negated() : value).toString(),
    positions: replacePosition(snapshot.positions, position),
  };
}

/** Cancellation releases only the original NEW order's reservation. */
export function cancelPendingOrder(snapshot: AccountSnapshot, order: SnapshotOrder): AccountSnapshot {
  if (order.status !== OrderStatus.NEW) throw new PortfolioDataError('Only a NEW order has a reservation to release');
  validateOrder(order);
  return changeReservation(snapshot, order, -1);
}

function changeReservation(snapshot: AccountSnapshot, order: SnapshotOrder, direction: 1 | -1): AccountSnapshot {
  if (order.type !== OrderType.LIMIT || !isInstrumentOrder(order.side)) {
    throw new PortfolioDataError('Invalid pending order');
  }
  if (order.side === OrderSide.BUY) {
    const reservedCash = new Amount(snapshot.reservedCash).plus(new Amount(order.price).mul(order.size).mul(direction));
    if (reservedCash.lt(0)) throw new PortfolioDataError('Snapshot cash reservation is inconsistent');
    return { ...snapshot, reservedCash: reservedCash.toString() };
  }
  const id = order.instrumentId.toString();
  const position = { ...(snapshot.positions.find(p => p.instrumentId === id) ?? {
    instrumentId: id, quantity: 0, reservedQuantity: 0, cost: '0', inconsistent: false,
  }) };
  position.reservedQuantity += direction * order.size;
  if (position.reservedQuantity < 0) throw new PortfolioDataError('Snapshot share reservation is inconsistent');
  return { ...snapshot, positions: replacePosition(snapshot.positions, position) };
}

function replacePosition(positions: SnapshotPosition[], position: SnapshotPosition): SnapshotPosition[] {
  const remaining = positions.filter(p => p.instrumentId !== position.instrumentId);
  if (position.quantity !== 0 || position.reservedQuantity !== 0) remaining.push(position);
  return remaining.sort((a, b) => a.instrumentId.localeCompare(b.instrumentId));
}

/** Input must be in ledger order (datetime, then ID). Used for recovery and fixtures. */
export function rebuildSnapshot(orders: SnapshotOrder[]): AccountSnapshot {
  return orders.reduce(applyOrder, emptySnapshot());
}
