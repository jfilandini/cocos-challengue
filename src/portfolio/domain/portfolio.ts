import Decimal from 'decimal.js';
import { OrderSide } from '../../shared/domain/order-side';
import { OrderStatus } from '../../shared/domain/order-status';
import { OrderType } from '../../shared/domain/order-type';
import { InstrumentType } from '../../shared/domain/instrument-type';
import { Currency } from '../../shared/domain/currency';

const Amount = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export interface PortfolioMovement {
  instrumentId: number;
  size: number;
  price: string;
  side: OrderSide;
  status: OrderStatus.FILLED | OrderStatus.NEW;
  type: OrderType;
}

export interface PortfolioInstrument {
  id: number;
  ticker: string | null;
  name: string | null;
  close: string | null;
  previousClose: string | null;
  date: string | null;
}

export interface PortfolioSnapshot {
  movements: PortfolioMovement[];
  instruments: PortfolioInstrument[];
}

export class PortfolioDataError extends Error {}
export class PortfolioPriceUnavailableError extends Error {}

export function calculatePortfolio(userId: number, snapshot: PortfolioSnapshot) {
  let cash = new Amount(0);
  let reservedCash = new Amount(0);
  const positions = new Map<number, { quantity: number; cost: Decimal; inconsistent: boolean }>();
  const reservedShares = new Map<number, number>();

  for (const order of snapshot.movements) {
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

  let total = cash;
  const instruments = new Map(snapshot.instruments.map(instrument => [instrument.id, instrument]));
  const stockPositions = [...positions.entries()].filter(([, p]) => p.quantity !== 0).map(([id, position]) => {
    const instrument = instruments.get(id);
    if (!instrument || instrument.close === null || !new Amount(instrument.close).gt(0)) {
      throw new PortfolioPriceUnavailableError(`Latest price unavailable for instrument ${id}`);
    }
    const close = new Amount(instrument.close);
    const marketValue = close.mul(position.quantity);
    total = total.plus(marketValue);
    const reserved = reservedShares.get(id) ?? 0;
    return {
      type: InstrumentType.ACCIONES,
      instrumentId: id,
      ticker: instrument.ticker,
      name: instrument.name,
      quantity: position.quantity,
      reservedQuantity: reserved,
      availableQuantity: position.quantity - reserved,
      price: close.toFixed(2),
      priceDate: instrument.date,
      marketValue: marketValue.toFixed(2),
      totalReturnPercent: position.inconsistent || !position.cost.gt(0)
        ? null : marketValue.minus(position.cost).div(position.cost).mul(100).toFixed(2),
      dailyReturnPercent: instrument.previousClose !== null && new Amount(instrument.previousClose).gt(0)
        ? close.minus(instrument.previousClose).div(instrument.previousClose).mul(100).toFixed(2) : null,
      inconsistentHistory: position.inconsistent,
    };
  }).sort((a, b) => (a.ticker ?? '').localeCompare(b.ticker ?? '') || a.instrumentId - b.instrumentId);

  const result: Array<(typeof stockPositions)[number] | {
    type: InstrumentType.MONEDA;
    instrumentId: number;
    ticker: string;
    name: string | null;
    quantity: string;
    reservedQuantity: string;
    availableQuantity: string;
    price: string;
    priceDate: null;
    marketValue: string;
    totalReturnPercent: null;
    dailyReturnPercent: null;
    inconsistentHistory: boolean;
  }> = [...stockPositions];

  if (!cash.isZero() || !reservedCash.isZero()) {
    const ars = snapshot.instruments.find(instrument => instrument.ticker === Currency.ARS);
    if (!ars) throw new PortfolioDataError('ARS instrument unavailable');
    result.push({
      type: InstrumentType.MONEDA,
      instrumentId: ars.id,
      ticker: Currency.ARS,
      name: ars.name,
      quantity: cash.toFixed(2),
      reservedQuantity: reservedCash.toFixed(2),
      availableQuantity: cash.minus(reservedCash).toFixed(2),
      price: '1.00',
      priceDate: null,
      marketValue: cash.toFixed(2),
      totalReturnPercent: null,
      dailyReturnPercent: null,
      inconsistentHistory: cash.lt(0) || cash.lt(reservedCash),
    });
  }
  result.sort((a, b) => (a.ticker ?? '').localeCompare(b.ticker ?? '') || a.instrumentId - b.instrumentId);

  return {
    userId,
    currency: Currency.ARS,
    totalValue: total.toFixed(2),
    cashBalance: cash.toFixed(2),
    reservedCash: reservedCash.toFixed(2),
    availableCash: cash.minus(reservedCash).toFixed(2),
    positions: result,
  };
}
