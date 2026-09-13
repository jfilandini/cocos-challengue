import { PortfolioDataError, type AccountSnapshot } from '../../account-snapshot/domain/account-snapshot';
import Decimal from 'decimal.js';
import { InstrumentType } from '../../shared/domain/instrument-type';
import { Currency } from '../../shared/domain/currency';

const Amount = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { PortfolioDataError } from '../../account-snapshot/domain/account-snapshot';

export interface PortfolioInstrument {
  id: bigint;
  ticker: string;
  name: string;
  close: string | null;
  previousClose: string | null;
  date: string | null;
}

export interface PortfolioSnapshot {
  account: AccountSnapshot;
  instruments: PortfolioInstrument[];
}

export class PortfolioPriceUnavailableError extends Error {}

function calculateTotalReturnPercent(cost: Decimal, marketValue: Decimal, inconsistent: boolean): string | null {
  if (inconsistent || !cost.gt(0)) return null;
  return marketValue.minus(cost).div(cost).mul(100).toFixed(2);
}

function calculateDailyReturnPercent(close: Decimal, previousClose: string | null): string | null {
  if (previousClose === null) return null;
  const previousPrice = new Amount(previousClose);
  if (!previousPrice.gt(0)) return null;
  return close.minus(previousPrice).div(previousPrice).mul(100).toFixed(2);
}

interface CurrencyPosition {
  type: InstrumentType.MONEDA;
  instrumentId: bigint;
  ticker: string;
  name: string;
  quantity: string;
  reservedQuantity: string;
  availableQuantity: string;
  price: string;
  priceDate: null;
  marketValue: string;
  totalReturnPercent: null;
  dailyReturnPercent: null;
  inconsistentHistory: boolean;
}

function createCurrencyPosition(snapshot: PortfolioSnapshot, settledCash: Decimal, reservedCash: Decimal): CurrencyPosition | null {
  if (settledCash.isZero() && reservedCash.isZero()) return null;

  const ars = snapshot.instruments.find(instrument => instrument.ticker === Currency.ARS);
  if (!ars) throw new PortfolioDataError('ARS instrument unavailable');

  return {
    type: InstrumentType.MONEDA,
    instrumentId: ars.id,
    ticker: Currency.ARS,
    name: ars.name,
    quantity: settledCash.toFixed(2),
    reservedQuantity: reservedCash.toFixed(2),
    availableQuantity: settledCash.minus(reservedCash).toFixed(2),
    price: '1.00',
    priceDate: null,
    marketValue: settledCash.toFixed(2),
    totalReturnPercent: null,
    dailyReturnPercent: null,
    inconsistentHistory: settledCash.lt(0) || settledCash.lt(reservedCash),
  };
}

export function calculatePortfolio(userId: bigint, snapshot: PortfolioSnapshot) {
  const settledCash = new Amount(snapshot.account.settledCash);
  const reservedCash = new Amount(snapshot.account.reservedCash);
  let total = settledCash;
  const instruments = new Map(snapshot.instruments.map(instrument => [instrument.id, instrument]));
  const stockPositions = snapshot.account.positions.filter(p => p.quantity !== 0).map(position => {
    const id = BigInt(position.instrumentId);
    const cost = new Amount(position.cost);
    const instrument = instruments.get(id);
    if (!instrument || instrument.close === null || !new Amount(instrument.close).gt(0)) {
      throw new PortfolioPriceUnavailableError(`Latest price unavailable for instrument ${id}`);
    }
    const close = new Amount(instrument.close);
    const marketValue = close.mul(position.quantity);
    total = total.plus(marketValue);
    const reserved = position.reservedQuantity;
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
      totalReturnPercent: calculateTotalReturnPercent(cost, marketValue, position.inconsistent),
      dailyReturnPercent: calculateDailyReturnPercent(close, instrument.previousClose),
      inconsistentHistory: position.inconsistent,
    };
  });
  const result: Array<(typeof stockPositions)[number] | CurrencyPosition> = [...stockPositions];
  const currencyPosition = createCurrencyPosition(snapshot, settledCash, reservedCash);
  if (currencyPosition) result.push(currencyPosition);
  result.sort((leftPosition, rightPosition) => leftPosition.ticker.localeCompare(rightPosition.ticker) || (leftPosition.instrumentId < rightPosition.instrumentId ? -1 : leftPosition.instrumentId > rightPosition.instrumentId ? 1 : 0));

  return {
    userId,
    currency: Currency.ARS,
    totalValue: total.toFixed(2),
    cashBalance: settledCash.toFixed(2),
    reservedCash: reservedCash.toFixed(2),
    availableCash: settledCash.minus(reservedCash).toFixed(2),
    positions: result,
  };
}
