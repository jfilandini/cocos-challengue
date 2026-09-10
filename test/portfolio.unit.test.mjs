import { rebuildSnapshot } from '../dist/snapshot/domain/account-snapshot.js';
import { InvalidDatabaseIdError } from '../dist/shared/domain/database-validator-helper.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculatePortfolio, PortfolioPriceUnavailableError } from '../dist/portfolio/domain/portfolio.js';
import { GetPortfolioUseCase, PortfolioUserNotFoundError } from '../dist/portfolio/application/get-portfolio.use-case.js';

const movement = (side, size, price = '1', overrides = {}) => ({ instrumentId: side.startsWith('CASH') ? 66n : 1n, side, size, price, type: 'MARKET', status: 'FILLED', ...overrides });
const instrument = { id: 1n, ticker: 'TEST', name: 'Test', close: '20', previousClose: '16', date: '2023-07-14' };
const ars = { id: 66n, ticker: 'ARS', name: 'PESOS', close: null, previousClose: null, date: null };
const portfolio = (movements, instruments = [instrument]) => calculatePortfolio(1n, { account: rebuildSnapshot(movements), instruments: [...instruments, ars] });

test('weighted cost survives partial sales; pending orders reserve resources without changing holdings', () => {
  const result = portfolio([
    movement('CASH_IN', 1000), movement('BUY', 10, '10'), movement('BUY', 10, '20'),
    movement('SELL', 5, '25'), movement('CASH_OUT', 100),
    movement('BUY', 2, '17', { status: 'NEW', type: 'LIMIT' }),
    movement('SELL', 3, '22', { status: 'NEW', type: 'LIMIT' }),
  ]);
  assert.equal(result.cashBalance, '725.00');
  assert.equal(result.reservedCash, '34.00');
  assert.equal(result.availableCash, '691.00');
  assert.equal(result.totalValue, '1025.00');
  assert.equal(result.positions.find(p => p.ticker === 'TEST').quantity, 15);
  assert.equal(result.positions.find(p => p.ticker === 'TEST').availableQuantity, 12);
  assert.equal(result.positions.find(p => p.ticker === 'TEST').marketValue, '300.00');
  assert.equal(result.positions.find(p => p.ticker === 'TEST').totalReturnPercent, '33.33');
  assert.equal(result.positions.find(p => p.ticker === 'TEST').dailyReturnPercent, '25.00');
});

test('a fully closed position is omitted and reopening resets the cost basis', () => {
  const history = [movement('CASH_IN', 100), movement('BUY', 2, '10'), movement('SELL', 2, '15')];
  assert.deepEqual(portfolio(history, []).positions.map(p => p.ticker), ['ARS']);
  const reopened = portfolio([...history, movement('BUY', 1, '20')]);
  assert.equal(reopened.positions.find(p => p.ticker === 'TEST').totalReturnPercent, '0.00');
});

test('oversold seed history preserves signed holdings and flags unavailable cost return', () => {
  const result = portfolio([movement('BUY', 20, '10'), movement('SELL', 30, '12')]);
  assert.equal(result.positions.find(p => p.ticker === 'TEST').quantity, -10);
  assert.equal(result.positions.find(p => p.ticker === 'TEST').marketValue, '-200.00');
  assert.equal(result.positions.find(p => p.ticker === 'TEST').totalReturnPercent, null);
  assert.equal(result.positions.find(p => p.ticker === 'TEST').inconsistentHistory, true);
});

test('missing latest price fails explicitly; missing previous close only removes daily return', () => {
  assert.throws(() => portfolio([movement('BUY', 1, '10')], []), PortfolioPriceUnavailableError);
  assert.throws(() => portfolio([movement('BUY', 1, '10')], [{ ...instrument, close: '0' }]), PortfolioPriceUnavailableError);
  const result = portfolio([movement('BUY', 1, '10')], [{ ...instrument, previousClose: '0' }]);
  assert.equal(result.positions.find(p => p.ticker === 'TEST').dailyReturnPercent, null);
});

test('decimal amounts do not accumulate binary floating-point errors', () => {
  const result = portfolio([movement('CASH_IN', 1), movement('BUY', 3, '0.10')], [{ ...instrument, close: '0.20' }]);
  assert.equal(result.cashBalance, '0.70');
  assert.equal(result.totalValue, '1.30');
  assert.equal(result.positions.find(p => p.ticker === 'TEST').totalReturnPercent, '100.00');
});

test('use case distinguishes missing users from empty portfolios and rejects invalid ids', async () => {
  const empty = new GetPortfolioUseCase({ async findByUserId() { return { account: rebuildSnapshot([]), instruments: [] }; } });
  assert.equal((await empty.execute(2)).totalValue, '0.00');
  const missing = new GetPortfolioUseCase({ async findByUserId() { return null; } });
  await assert.rejects(missing.execute(99), PortfolioUserNotFoundError);
  for (const id of [1.5, NaN, 'abc']) await assert.rejects(empty.execute(id), InvalidDatabaseIdError);
});


test('cash-only and fractional cash positions reconcile with total value without double counting', () => {
  const cashOnly = portfolio([movement('CASH_IN', 100)], []);
  assert.equal(cashOnly.positions.length, 1);
  assert.equal(cashOnly.positions[0].marketValue, cashOnly.totalValue);
  assert.equal(cashOnly.positions[0].totalReturnPercent, null);
  const result = portfolio([
    movement('CASH_IN', 1), movement('BUY', 3, '0.10'),
    movement('BUY', 1, '0.20', { status: 'NEW', type: 'LIMIT' }),
  ], [{ ...instrument, close: '0.20' }]);
  const cash = result.positions.find(p => p.type === 'MONEDA');
  assert.equal(cash.quantity, '0.70');
  assert.equal(cash.reservedQuantity, '0.20');
  assert.equal(cash.availableQuantity, '0.50');
  assert.equal(cash.marketValue, '0.70');
  assert.equal(result.totalValue, '1.30');
});
