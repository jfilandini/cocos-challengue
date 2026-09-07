import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  InvalidInstrumentSearchError,
  SearchInstrumentsUseCase,
} from '../dist/instruments/application/search-instruments.use-case.js';

test('runs without NestJS or Prisma and passes normalized literal input to its port', async () => {
  const results = [{ id: 1, ticker: 'TEST', name: 'Test stock', type: 'ACCIONES' }];
  const useCase = new SearchInstrumentsUseCase({
    async search(query) {
      assert.equal(query, 'Te%_st');
      return results;
    },
  });

  assert.deepEqual(await useCase.execute('  Te%_st  '), results);
});

test('rejects invalid input before accessing persistence', () => {
  const useCase = new SearchInstrumentsUseCase({
    async search() {
      assert.fail('Invalid input must not reach persistence');
    },
  });

  for (const query of [undefined, null, 42, {}, ['A', 'B'], '', '  ', 'a'.repeat(256)]) {
    assert.throws(() => useCase.execute(query), InvalidInstrumentSearchError);
  }
});

test('accepts the maximum search length after trimming', async () => {
  const useCase = new SearchInstrumentsUseCase({
    async search(query) {
      assert.equal(query.length, 255);
      return [];
    },
  });
  assert.deepEqual(await useCase.execute(` ${'a'.repeat(255)} `), []);
});

test('propagates persistence failures without treating them as invalid input', async () => {
  const failure = new Error('Database unavailable');
  const useCase = new SearchInstrumentsUseCase({
    async search() { throw failure; },
  });
  await assert.rejects(useCase.execute('YPFD'), (error) => error === failure);
});
