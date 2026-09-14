import { instrumentRepository } from '../support/ports.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  InvalidInstrumentSearchError,
  SearchInstrumentsUseCase,
} from '../../src/instruments/application/search-instruments.use-case.js';


void test('rejects invalid input before accessing persistence', () => {
  const useCase = new SearchInstrumentsUseCase(instrumentRepository({
    async search() {
      assert.fail('Invalid input must not reach persistence');
    },
  }));

  for (const query of [undefined, null, 42, {}, ['A', 'B'], '', '  ']) {
    assert.throws(() => useCase.execute(query), InvalidInstrumentSearchError);
  }
});

void test('accepts search terms longer than 255 characters after trimming', async () => {
  const useCase = new SearchInstrumentsUseCase(instrumentRepository({
    async search(query) {
      assert.equal(query.length, 256);
      return { items: [], total: 0 };
    },
  }));
  assert.deepEqual(await useCase.execute(` ${'a'.repeat(256)} `), { items: [], total: 0, page: 1, limit: 20, totalPages: 0 });
});

void test('propagates persistence failures without treating them as invalid input', async () => {
  const failure = new Error('Database unavailable');
  const useCase = new SearchInstrumentsUseCase(instrumentRepository({
    async search() { throw failure; },
  }));
  await assert.rejects(useCase.execute('YPFD'), (error) => error === failure);
});

void test('normalizes pagination and derives metadata from the total, not the page length', async () => {
  const useCase = new SearchInstrumentsUseCase(instrumentRepository({
    async search(query, pagination) {
      assert.equal(query, 'test');
      assert.deepEqual(pagination, { page: 2, limit: 2 });
      return { items: [], total: 3 };
    },
  }));
  assert.deepEqual(await useCase.execute('test', '2', '2'), {
    items: [], total: 3, page: 2, limit: 2, totalPages: 2,
  });
});

void test('rejects malformed pagination before accessing persistence', () => {
  const useCase = new SearchInstrumentsUseCase(instrumentRepository({
    async search() { assert.fail('Invalid pagination must not reach persistence'); },
  }));
  for (const value of [null, '', ' ', 'abc', '1.5', '-1', '0', '1e2', [], ['1', '2'], true, 0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => useCase.execute('test', value), InvalidInstrumentSearchError);
    assert.throws(() => useCase.execute('test', undefined, value), InvalidInstrumentSearchError);
  }
  assert.throws(() => useCase.execute('test', 1, 101), InvalidInstrumentSearchError);
});
