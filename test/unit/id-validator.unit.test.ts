import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InvalidIdError, validateId } from '../../src/shared/domain/id-validator-helper.js';

void test('IDs preserve exact strings and bigints while retaining safe numeric inputs', () => {
  assert.equal(validateId(1), 1n);
  assert.equal(validateId(Number.MAX_SAFE_INTEGER), 9007199254740991n);
  assert.equal(validateId('9007199254740993'), 9007199254740993n);
  assert.equal(validateId(9007199254740993n), 9007199254740993n);
  assert.equal(validateId('9223372036854775807'), 9223372036854775807n);
});

void test('IDs reject rounded JSON numbers, invalid formats and database range overflow', () => {
  const rounded: unknown = JSON.parse('9007199254740993');
  assert.equal(rounded, 9007199254740992);
  for (const value of [rounded, NaN, Infinity, 1.5, 0, -1, 0n, -1n,
    '', ' ', '01', '0x10', '1e3', '+1', '1.0', '9223372036854775808',
    9223372036854775808n, null, undefined, true, {}]) {
    assert.throws(() => validateId(value), InvalidIdError);
  }
});
