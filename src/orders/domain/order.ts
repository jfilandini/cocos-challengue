import Decimal from 'decimal.js';
import { isCashTransfer, OrderSide } from '../../shared/domain/order-side';
import { OrderStatus } from '../../shared/domain/order-status';
import { OrderType } from '../../shared/domain/order-type';
import type { AccountSnapshot } from '../../shared/domain/account-snapshot';

const Amount = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export class InvalidOrderError extends Error {}
export class OrderResourceNotFoundError extends Error {}
export class OrderPriceUnavailableError extends Error {}
export class OrderCancellationError extends Error {}

export interface CancelledOrder {
  id: bigint;
  userId: bigint;
  status: OrderStatus.CANCELLED;
}

export function isCancellable(status: OrderStatus): void {
  if (status !== OrderStatus.NEW) throw new OrderCancellationError('Only NEW orders can be cancelled');
}

export interface OrderRequest {
  instrumentId: bigint;
  side: OrderSide;
  type: OrderType;
  size?: number;
  amount?: string;
  price?: string;
}

export interface OrderDraft {
  userId: bigint;
  instrumentId: bigint;
  side: OrderSide;
  type: OrderType;
  size: number;
  price: string;
  status: OrderStatus.NEW | OrderStatus.FILLED | OrderStatus.REJECTED;
}

export interface SubmittedOrder extends Omit<OrderDraft, 'status'> {
  status: OrderStatus;
  transactionId: string;
  id: bigint;
  datetime: string;
}

export function generateOrderDraft(userId: bigint, request: OrderRequest, close: string | null, snapshot: AccountSnapshot): OrderDraft {
  const transfer = isCashTransfer(request.side);
  const rawPrice = transfer ? '1.00' : request.type === OrderType.LIMIT ? request.price : close;
  if (!rawPrice || !new Amount(rawPrice).isFinite() || !new Amount(rawPrice).gt(0)) {
    throw new OrderPriceUnavailableError('Latest market price is unavailable');
  }
  const price = new Amount(rawPrice);
  const quantity = request.size === undefined ? new Amount(request.amount!).div(price).floor() : new Amount(request.size);
  if (!quantity.gt(0)) throw new InvalidOrderError('Calculated size must be greater than 0');
  const size = quantity.toNumber();
  const availableCash = new Amount(snapshot.cash).minus(snapshot.reservedCash);
  const position = snapshot.positions.find(p => p.instrumentId === request.instrumentId.toString());
  const availableShares = (position?.quantity ?? 0) - (position?.reservedQuantity ?? 0);
  const sufficient = request.side === OrderSide.CASH_IN ||
    (request.side === OrderSide.BUY || request.side === OrderSide.CASH_OUT
      ? availableCash.gte(price.mul(size)) && (request.amount === undefined || availableCash.gte(request.amount))
      : availableShares >= size);
  return {
    userId, instrumentId: request.instrumentId, side: request.side, type: request.type,
    size, price: price.toFixed(2),
    status: !sufficient ? OrderStatus.REJECTED : request.type === OrderType.MARKET ? OrderStatus.FILLED : OrderStatus.NEW,
  };
}
