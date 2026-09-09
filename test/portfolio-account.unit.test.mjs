import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GetPortfolioByAccountNumberUseCase, InvalidPortfolioAccountError, PortfolioAccountNotFoundError } from '../dist/portfolio/application/get-portfolio-by-account-number.use-case.js';
import { AmbiguousPortfolioAccountError } from '../dist/portfolio/application/ports/portfolio.repository.js';
import { PrismaPortfolioRepository } from '../dist/portfolio/infrastructure/persistence/prisma-portfolio.repository.js';

test('account lookup trims whitespace but preserves leading zeros and uses the resolved user', async () => {
  const useCase = new GetPortfolioByAccountNumberUseCase({
    async findByAccountNumber(account) {
      assert.equal(account, '00123');
      return { userId: 7n, movements: [], instruments: [] };
    },
  });
  assert.equal((await useCase.execute(' 00123 ')).userId, 7n);
});

test('invalid accounts do not query persistence; unknown accounts are distinguished', async () => {
  const useCase = new GetPortfolioByAccountNumberUseCase({
    async findByAccountNumber() { assert.fail('Must not query invalid input'); },
  });
  for (const value of [null, undefined, 123, '', ' ', 'a'.repeat(21)]) {
    await assert.rejects(useCase.execute(value), InvalidPortfolioAccountError);
  }
  await assert.rejects(new GetPortfolioByAccountNumberUseCase({ async findByAccountNumber() { return null; } }).execute('missing'), PortfolioAccountNotFoundError);
});

test('repository rejects duplicate account matches before reading any movements', async () => {
  const repository = new PrismaPortfolioRepository({
    async $transaction(callback) {
      return callback({ user: { async findMany() { return [{ id: 1n }, { id: 2n }]; } } });
    },
  });
  await assert.rejects(repository.findByAccountNumber('duplicate'), AmbiguousPortfolioAccountError);
});
