import { instrumentRepository, portfolioRepository } from '../support/ports.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptySnapshot } from '../../src/account-snapshot/domain/account-snapshot.js';
import { InvalidIdError } from '../../src/shared/domain/id-validator-helper.js';
import { GetPortfolioUseCase, PortfolioUserNotFoundError } from '../../src/portfolio/application/get-portfolio.use-case.js';
import { GetPortfolioByAccountNumberUseCase, InvalidPortfolioAccountError, PortfolioAccountNotFoundError } from '../../src/portfolio/application/get-portfolio-by-account-number.use-case.js';

void test('use case distinguishes missing users from empty portfolios and rejects invalid ids', async () => {
  const empty = new GetPortfolioUseCase(portfolioRepository({ async findByUserId() { return { userId: 2n, account: emptySnapshot() }; } }), instrumentRepository({ async findWithLatestPrices(ids, currency) {
    assert.deepEqual(ids, []);
    assert.equal(currency, 'ARS');
    return [];
  } }));
  assert.equal((await empty.execute(2)).totalValue, '0.00');
  const missing = new GetPortfolioUseCase(portfolioRepository({ async findByUserId() { return null; } }), instrumentRepository({}));
  await assert.rejects(missing.execute(99), PortfolioUserNotFoundError);
  for (const id of [1.5, NaN, 'abc']) await assert.rejects(empty.execute(id), InvalidIdError);
});

void test('account lookup trims whitespace but preserves leading zeros and uses the resolved user', async () => {
  const useCase = new GetPortfolioByAccountNumberUseCase(portfolioRepository({
    async findByAccountNumber(account) {
      assert.equal(account, '00123');
      return { userId: 7n, account: emptySnapshot() };
    },
  }), instrumentRepository({ async findWithLatestPrices() { return []; } }));
  assert.equal((await useCase.execute(' 00123 ')).userId, 7n);
});

void test('invalid accounts do not query persistence; unknown accounts are distinguished', async () => {
  const useCase = new GetPortfolioByAccountNumberUseCase(portfolioRepository({
    async findByAccountNumber() { assert.fail('Must not query invalid input'); },
  }), instrumentRepository({}));
  for (const value of [null, undefined, 123, '', ' ', 'a'.repeat(21)]) {
    await assert.rejects(useCase.execute(value), InvalidPortfolioAccountError);
  }
  await assert.rejects(new GetPortfolioByAccountNumberUseCase(portfolioRepository({ async findByAccountNumber() { return null; } }), instrumentRepository({})).execute('missing'), PortfolioAccountNotFoundError);
});

void test('both portfolio lookups value positions using the instrument repository', async () => {
  const account = {
    settledCash: '10', reservedCash: '0',
    positions: [{ instrumentId: '9007199254740993', quantity: 2, reservedQuantity: 0, cost: '30', inconsistent: false }],
  };
  const portfolios = portfolioRepository({
    async findByUserId() { return { userId: 7n, account }; },
    async findByAccountNumber() { return { userId: 7n, account }; },
  });
  let reads = 0;
  const instruments = instrumentRepository({
    async findWithLatestPrices(ids, currency) {
      reads++;
      assert.deepEqual(ids, [9007199254740993n]);
      assert.equal(currency, 'ARS');
      return [
        { id: ids[0], ticker: 'TEST', name: 'Test', close: '20', previousClose: '16', date: '2023-07-14' },
        { id: 66n, ticker: 'ARS', name: 'Pesos', close: null, previousClose: null, date: null },
      ];
    },
  });
  const byUser = await new GetPortfolioUseCase(portfolios, instruments).execute('7');
  const byAccount = await new GetPortfolioByAccountNumberUseCase(portfolios, instruments).execute('00123');
  assert.deepEqual(byAccount, byUser);
  assert.equal(byUser.totalValue, '50.00');
  assert.equal(byUser.positions.length, 2);
  assert.equal(reads, 2);
});
