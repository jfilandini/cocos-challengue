import Decimal from 'decimal.js';
import { isCashTransfer, isOrderSide, OrderSide } from '../../shared/domain/order-side';
import { OrderStatus } from '../../shared/domain/order-status';
import { OrderType } from '../../shared/domain/order-type';
import { calculateLedger, type LedgerMovement } from '../../shared/domain/ledger';

const Amount = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export class InvalidOrderError extends Error {}
export class OrderResourceNotFoundError extends Error {}
export class OrderPriceUnavailableError extends Error {}
export class OrderCancellationError extends Error {}

export interface CancelledOrder {
  id: number;
  userId: number;
  status: OrderStatus.CANCELLED;
}

export function assertCancellable(status: OrderStatus): void {
  if (status !== OrderStatus.NEW) throw new OrderCancellationError('Only NEW orders can be cancelled');
}

export interface OrderRequest {
  instrumentId: number;
  side: OrderSide;
  type: OrderType;
  size?: number;
  amount?: string;
  price?: string;
}

export interface OrderDraft {
  userId: number;
  instrumentId: number;
  side: OrderSide;
  type: OrderType;
  size: number;
  price: string;
  status: OrderStatus.NEW | OrderStatus.FILLED | OrderStatus.REJECTED;
}

export interface SubmittedOrder extends OrderDraft {
  id: number;
  datetime: string;
}

function money(value: unknown, field: string): string {
  if ((typeof value !== 'string' && typeof value !== 'number') ||
      !/^\d{1,16}(\.\d{1,2})?$/.test(String(value))) {
    throw new InvalidOrderError(`${field} must be a positive decimal with at most two decimal places`);
  }
  const amount = new Amount(value);
  if (!amount.gt(0)) throw new InvalidOrderError(`${field} must be positive`);
  if (field === 'price' && amount.gt('99999999.99')) throw new InvalidOrderError('price exceeds database precision');
  return amount.toFixed(2);
}

export function validateOrder(userId: number, body: unknown): OrderRequest {
  if (!Number.isInteger(userId) || userId <= 0 || userId > 2147483647) throw new InvalidOrderError('Invalid userId');
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InvalidOrderError('Expected an order object');
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => !['instrumentId', 'side', 'type', 'size', 'amount', 'price'].includes(key))) {
    throw new InvalidOrderError('Unknown order field');
  }
  const { instrumentId, side, type, size, amount, price } = input;
  if (typeof instrumentId !== 'number' || !Number.isInteger(instrumentId) || instrumentId <= 0 || instrumentId > 2147483647) {
    throw new InvalidOrderError('Invalid instrumentId');
  }
  if (!isOrderSide(side)) throw new InvalidOrderError('Invalid order side');
  if (type !== OrderType.MARKET && type !== OrderType.LIMIT) throw new InvalidOrderError('type must be MARKET or LIMIT');
  if ((size !== undefined) === (amount !== undefined)) throw new InvalidOrderError('Send exactly one of size or amount');
  if (size !== undefined && (typeof size !== 'number' || !Number.isInteger(size) || size <= 0 || size > 2147483647)) {
    throw new InvalidOrderError('size must be a positive 32-bit integer');
  }
  if (type === OrderType.MARKET && price !== undefined) throw new InvalidOrderError('MARKET does not accept price');
  const normalizedAmount = amount === undefined ? undefined : money(amount, 'amount');
  if (isCashTransfer(side)) {
    if (type !== OrderType.MARKET) throw new InvalidOrderError('Cash transfers require MARKET');
    if (normalizedAmount !== undefined && (!new Amount(normalizedAmount).isInteger() || new Amount(normalizedAmount).gt(2147483647))) {
      throw new InvalidOrderError('Cash transfers require whole pesos within the 32-bit size limit');
    }
  }
  return {
    instrumentId, side, type,
    size,
    amount: normalizedAmount,
    price: type === OrderType.LIMIT ? money(price, 'price') : undefined,
  };
}

export function decideOrder(userId: number, request: OrderRequest, close: string | null, movements: LedgerMovement[]): OrderDraft {
  const transfer = isCashTransfer(request.side);
  const rawPrice = transfer ? '1.00' : request.type === OrderType.LIMIT ? request.price : close;
  if (!rawPrice || !new Amount(rawPrice).isFinite() || !new Amount(rawPrice).gt(0)) {
    throw new OrderPriceUnavailableError('Latest market price is unavailable');
  }
  const price = new Amount(rawPrice);
  const quantity = request.size === undefined ? new Amount(request.amount!).div(price).floor() : new Amount(request.size);
  if (!quantity.gt(0) || quantity.gt(2147483647)) throw new InvalidOrderError('Calculated size must be between 1 and 2147483647');
  const size = quantity.toNumber();
  const ledger = calculateLedger(movements);
  const availableCash = ledger.cash.minus(ledger.reservedCash);
  const availableShares = (ledger.positions.get(request.instrumentId)?.quantity ?? 0) - (ledger.reservedShares.get(request.instrumentId) ?? 0);
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
