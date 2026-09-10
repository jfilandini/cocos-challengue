import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readAccountSnapshot, initializeAccountSnapshot } from '../dist/snapshot/infrastructure/persistence/account-snapshot.repository.js';

test('reading a missing snapshot returns null without reading orders or writing', async () => {
  const tx = {
    accountSnapshot: {
      async findUnique({ where }) { assert.equal(where.userId, 1n); return null; },
      async upsert() { assert.fail('A read must not write'); },
    },
    order: { async findMany() { assert.fail('A read must not replay orders'); } },
  };
  assert.equal(await readAccountSnapshot(tx, 1n), null);
});

test('initializing an existing snapshot preserves it without replaying or writing', async () => {
  const tx = {
    accountSnapshot: {
      async findUnique() { return { settledCash: '100', reservedCash: '20', positions: [] }; },
      async upsert() { assert.fail('Existing snapshot must not be overwritten'); },
    },
    order: { async findMany() { assert.fail('Existing snapshot must not be rebuilt'); } },
  };
  assert.deepEqual(await initializeAccountSnapshot(tx, 1n), { settledCash: '100', reservedCash: '20', positions: [] });
});
