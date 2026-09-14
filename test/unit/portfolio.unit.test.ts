import { InstrumentType } from '../../src/shared/domain/instrument-type.js';
import { OrderSide } from '../../src/shared/domain/order-side.js';
import type { SnapshotOrder } from '../../src/account-snapshot/domain/account-snapshot.js';
import type { PortfolioInstrument } from '../../src/portfolio/domain/portfolio.js';
import { present } from '../support/assertions.js';
import { OrderStatus } from '../../src/shared/domain/order-status.js';
import { OrderType } from '../../src/shared/domain/order-type.js';
import { rebuildSnapshot } from '../../src/account-snapshot/domain/account-snapshot.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculatePortfolio, PortfolioPriceUnavailableError } from '../../src/portfolio/domain/portfolio.js';

const movement = (side: SnapshotOrder['side'], size: number, price = '1', overrides: Partial<SnapshotOrder> = {}): SnapshotOrder => ({ instrumentId: side.startsWith('CASH') ? 66n : 1n, side, size, price, type: OrderType.MARKET, status: OrderStatus.FILLED, ...overrides });
const instrument: PortfolioInstrument = { id: 1n, ticker: 'TEST', name: 'Test', close: '20', previousClose: '16', date: '2023-07-14' };
const ars: PortfolioInstrument = { id: 66n, ticker: 'ARS', name: 'PESOS', close: null, previousClose: null, date: null };
const portfolio = (movements: SnapshotOrder[], instruments: PortfolioInstrument[] = [instrument]) => calculatePortfolio(1n, { account: rebuildSnapshot(movements), instruments: [...instruments, ars] });

void test('weighted cost survives partial sales; pending orders reserve resources without changing holdings', () => {
  const result = portfolio([
    movement(OrderSide.CASH_IN, 1000), movement(OrderSide.BUY, 10, '10'), movement(OrderSide.BUY, 10, '20'),
    movement(OrderSide.SELL, 5, '25'), movement(OrderSide.CASH_OUT, 100),
    movement(OrderSide.BUY, 2, '17', { status: OrderStatus.NEW, type: OrderType.LIMIT }),
    movement(OrderSide.SELL, 3, '22', { status: OrderStatus.NEW, type: OrderType.LIMIT }),
  ]);
  assert.equal(result.cashBalance, '725.00');
  assert.equal(result.reservedCash, '34.00');
  assert.equal(result.availableCash, '691.00');
  assert.equal(result.totalValue, '1025.00');
  assert.equal(present(result.positions.find(p => p.ticker === 'TEST')).quantity, 15);
  assert.equal(present(result.positions.find(p => p.ticker === 'TEST')).availableQuantity, 12);
  assert.equal(present(result.positions.find(p => p.ticker === 'TEST')).marketValue, '300.00');
  assert.equal(present(result.positions.find(p => p.ticker === 'TEST')).totalReturnPercent, '33.33');
  assert.equal(present(result.positions.find(p => p.ticker === 'TEST')).dailyReturnPercent, '25.00');
});

void test('a fully closed position is omitted and reopening resets the cost basis', () => {
  const history = [movement(OrderSide.CASH_IN, 100), movement(OrderSide.BUY, 2, '10'), movement(OrderSide.SELL, 2, '15')];
  assert.deepEqual(portfolio(history, []).positions.map(p => p.ticker), ['ARS']);
  const reopened = portfolio([...history, movement(OrderSide.BUY, 1, '20')]);
  assert.equal(present(reopened.positions.find(p => p.ticker === 'TEST')).totalReturnPercent, '0.00');
});

void test('oversold seed history preserves signed holdings and flags unavailable cost return', () => {
  const result = portfolio([movement(OrderSide.BUY, 20, '10'), movement(OrderSide.SELL, 30, '12')]);
  assert.equal(present(result.positions.find(p => p.ticker === 'TEST')).quantity, -10);
  assert.equal(present(result.positions.find(p => p.ticker === 'TEST')).marketValue, '-200.00');
  assert.equal(present(result.positions.find(p => p.ticker === 'TEST')).totalReturnPercent, null);
  assert.equal(present(result.positions.find(p => p.ticker === 'TEST')).inconsistentHistory, true);
});

void test('missing latest price fails explicitly; missing previous close only removes daily return', () => {
  assert.throws(() => portfolio([movement(OrderSide.BUY, 1, '10')], []), PortfolioPriceUnavailableError);
  assert.throws(() => portfolio([movement(OrderSide.BUY, 1, '10')], [{ ...instrument, close: '0' }]), PortfolioPriceUnavailableError);
  for (const previousClose of [null, '0']) {
    const result = portfolio([movement(OrderSide.BUY, 1, '10')], [{ ...instrument, previousClose }]);
    assert.equal(present(result.positions.find(p => p.ticker === 'TEST')).dailyReturnPercent, null);
  }
});

void test('cash positions and decimal trades preserve precision, reserves and total valuation', () => {
  const cashOnly = portfolio([movement(OrderSide.CASH_IN, 100)], []);
  assert.equal(cashOnly.positions.length, 1);
  assert.equal(cashOnly.positions[0].marketValue, cashOnly.totalValue);
  assert.equal(cashOnly.positions[0].totalReturnPercent, null);
  const result = portfolio([
    movement(OrderSide.CASH_IN, 1), movement(OrderSide.BUY, 3, '0.10'),
    movement(OrderSide.BUY, 1, '0.20', { status: OrderStatus.NEW, type: OrderType.LIMIT }),
  ], [{ ...instrument, close: '0.20' }]);
  const cash = result.positions.find(p => p.type === InstrumentType.MONEDA);
  assert.ok(cash);
  assert.equal(cash.quantity, '0.70');
  assert.equal(cash.reservedQuantity, '0.20');
  assert.equal(cash.availableQuantity, '0.50');
  assert.equal(cash.marketValue, '0.70');
  assert.equal(result.cashBalance, '0.70');
  assert.equal(result.totalValue, '1.30');
  assert.equal(present(result.positions.find(p => p.ticker === 'TEST')).totalReturnPercent, '100.00');
});
