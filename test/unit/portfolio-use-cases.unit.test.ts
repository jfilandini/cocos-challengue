import { portfolioRepository } from '../support/ports.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptySnapshot } from '../../src/snapshot/domain/account-snapshot.js';
import { InvalidIdError } from '../../src/shared/domain/id-validator-helper.js';
import { GetPortfolioUseCase, PortfolioUserNotFoundError } from '../../src/portfolio/application/get-portfolio.use-case.js';
import { GetPortfolioByAccountNumberUseCase, InvalidPortfolioAccountError, PortfolioAccountNotFoundError } from '../../src/portfolio/application/get-portfolio-by-account-number.use-case.js';

void test('use case distinguishes missing users from empty portfolios and rejects invalid ids', async () => {
  const empty = new GetPortfolioUseCase(portfolioRepository({ async findByUserId() { return { account: emptySnapshot(), instruments: [] }; } }));
  assert.equal((await empty.execute(2)).totalValue, '0.00');
  const missing = new GetPortfolioUseCase(portfolioRepository({ async findByUserId() { return null; } }));
  await assert.rejects(missing.execute(99), PortfolioUserNotFoundError);
  for (const id of [1.5, NaN, 'abc']) await assert.rejects(empty.execute(id), InvalidIdError);
});

void test('account lookup trims whitespace but preserves leading zeros and uses the resolved user', async () => {
  const useCase = new GetPortfolioByAccountNumberUseCase(portfolioRepository({
    async findByAccountNumber(account) {
      assert.equal(account, '00123');
      return { userId: 7n, account: emptySnapshot(), instruments: [] };
    },
  }));
  assert.equal((await useCase.execute(' 00123 ')).userId, 7n);
});

void test('invalid accounts do not query persistence; unknown accounts are distinguished', async () => {
  const useCase = new GetPortfolioByAccountNumberUseCase(portfolioRepository({
    async findByAccountNumber() { assert.fail('Must not query invalid input'); },
  }));
  for (const value of [null, undefined, 123, '', ' ', 'a'.repeat(21)]) {
    await assert.rejects(useCase.execute(value), InvalidPortfolioAccountError);
  }
  await assert.rejects(new GetPortfolioByAccountNumberUseCase(portfolioRepository({ async findByAccountNumber() { return null; } })).execute('missing'), PortfolioAccountNotFoundError);
});
