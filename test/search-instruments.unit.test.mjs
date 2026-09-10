import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  InvalidInstrumentSearchError,
  SearchInstrumentsUseCase,
} from '../dist/instruments/application/search-instruments.use-case.js';

test('runs without NestJS or Prisma and passes normalized literal input to its port', async () => {
  const results = [{ id: 1n, ticker: 'TEST', name: 'Test stock', type: 'ACCIONES' }];
  const useCase = new SearchInstrumentsUseCase({
    async search(query, pagination) {
      assert.deepEqual(pagination, { page: 1, limit: 20 });
      assert.equal(query, 'Te%_st');
      return { items: results, total: results.length };
    },
  });

  assert.deepEqual(await useCase.execute('  Te%_st  '), { items: results, total: 1, page: 1, limit: 20, totalPages: 1 });
});

test('rejects invalid input before accessing persistence', () => {
  const useCase = new SearchInstrumentsUseCase({
    async search() {
      assert.fail('Invalid input must not reach persistence');
    },
  });

  for (const query of [undefined, null, 42, {}, ['A', 'B'], '', '  ']) {
    assert.throws(() => useCase.execute(query), InvalidInstrumentSearchError);
  }
});

test('accepts search terms longer than 255 characters after trimming', async () => {
  const useCase = new SearchInstrumentsUseCase({
    async search(query) {
      assert.equal(query.length, 256);
      return { items: [], total: 0 };
    },
  });
  assert.deepEqual(await useCase.execute(` ${'a'.repeat(256)} `), { items: [], total: 0, page: 1, limit: 20, totalPages: 0 });
});

test('propagates persistence failures without treating them as invalid input', async () => {
  const failure = new Error('Database unavailable');
  const useCase = new SearchInstrumentsUseCase({
    async search() { throw failure; },
  });
  await assert.rejects(useCase.execute('YPFD'), (error) => error === failure);
});

test('normalizes pagination and derives metadata from the total, not the page length', async () => {
  const useCase = new SearchInstrumentsUseCase({
    async search(query, pagination) {
      assert.equal(query, 'test');
      assert.deepEqual(pagination, { page: 2, limit: 2 });
      return { items: [], total: 3 };
    },
  });
  assert.deepEqual(await useCase.execute('test', '2', '2'), {
    items: [], total: 3, page: 2, limit: 2, totalPages: 2,
  });
});

test('rejects malformed pagination before accessing persistence', () => {
  const useCase = new SearchInstrumentsUseCase({
    async search() { assert.fail('Invalid pagination must not reach persistence'); },
  });
  for (const value of [null, '', ' ', 'abc', '1.5', '-1', '0', '1e2', [], ['1', '2'], true, 0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => useCase.execute('test', value), InvalidInstrumentSearchError);
    assert.throws(() => useCase.execute('test', undefined, value), InvalidInstrumentSearchError);
  }
  assert.throws(() => useCase.execute('test', 1, 101), InvalidInstrumentSearchError);
});
