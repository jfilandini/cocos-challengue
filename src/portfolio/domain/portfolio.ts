import { calculateLedger, PortfolioDataError, type LedgerMovement } from '../../shared/domain/ledger';
import Decimal from 'decimal.js';
import { InstrumentType } from '../../shared/domain/instrument-type';
import { Currency } from '../../shared/domain/currency';

const Amount = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type { LedgerMovement as PortfolioMovement } from '../../shared/domain/ledger';
export { PortfolioDataError } from '../../shared/domain/ledger';

export interface PortfolioInstrument {
  id: bigint;
  ticker: string | null;
  name: string | null;
  close: string | null;
  previousClose: string | null;
  date: string | null;
}

export interface PortfolioSnapshot {
  movements: LedgerMovement[];
  instruments: PortfolioInstrument[];
}

export class PortfolioPriceUnavailableError extends Error {}

export function calculatePortfolio(userId: bigint, snapshot: PortfolioSnapshot) {
  const { cash, reservedCash, positions, reservedShares } = calculateLedger(snapshot.movements);

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
  }).sort((a, b) => (a.ticker ?? '').localeCompare(b.ticker ?? '') || (a.instrumentId < b.instrumentId ? -1 : a.instrumentId > b.instrumentId ? 1 : 0));

  const result: Array<(typeof stockPositions)[number] | {
    type: InstrumentType.MONEDA;
    instrumentId: bigint;
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
  result.sort((a, b) => (a.ticker ?? '').localeCompare(b.ticker ?? '') || (a.instrumentId < b.instrumentId ? -1 : a.instrumentId > b.instrumentId ? 1 : 0));

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
