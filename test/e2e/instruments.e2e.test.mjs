import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../dist/app.module.js';

// Read-only functional tests against the challenge's seeded PostgreSQL database.
let app;
let baseUrl;

before(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
});

after(async () => {
  await app?.close();
});

async function search(term) {
  const response = await fetch(`${baseUrl}/instruments?query=${encodeURIComponent(term)}`);
  assert.equal(response.status, 200);
  return (await response.json()).items;
}

test('finds a partial ticker, ignoring case and surrounding whitespace', async () => {
  const results = await search('  ypF  ');
  assert.deepEqual(results, [
    { id: '50', ticker: 'YPFD', name: 'Y.P.F. S.A.', type: 'ACCIONES' },
  ]);
});

test('finds partial names and returns results ordered by ticker', async () => {
  const results = await search('mOLin');
  assert.deepEqual(results.map(({ ticker }) => ticker), ['MOLA', 'MOLI', 'SEMI']);
});

test('combines ticker and name matches without duplicate instruments', async () => {
  const results = await search('pamp');
  assert.deepEqual(results.map(({ ticker }) => ticker), ['PAMP']);
});

test('returns an empty list for absent matches and finds currencies by ticker or name', async () => {
  assert.deepEqual(await search('no-such-instrument'), []);
  const cash = { id: '66', ticker: 'ARS', name: 'PESOS', type: 'MONEDA' };
  assert.deepEqual(await search('pesos'), [cash]);
  assert.deepEqual(await search('ars'), [cash]);
});

test('treats SQL pattern characters and quotes as literal input', async () => {
  for (const term of ['%', '_', '\\', "' OR 1=1 --"]) {
    assert.deepEqual(await search(term), []);
  }
});

test('rejects missing, blank, and repeated search terms', async () => {
  for (const query of ['', '?query=', '?query=%20%20', '?query=GGAL&query=BMA']) {
    const response = await fetch(`${baseUrl}/instruments${query}`);
    assert.equal(response.status, 400);
  }
});

test('accepts search terms longer than 255 characters', async () => {
  assert.deepEqual(await search('a'.repeat(256)), []);
});

async function searchPage(parameters) {
  const response = await fetch(`${baseUrl}/instruments?${new URLSearchParams(parameters)}`);
  assert.equal(response.status, 200);
  return response.json();
}

test('returns default pagination metadata', async () => {
  const result = await searchPage({ query: 'molin' });
  assert.equal(result.items.length, 3);
  assert.deepEqual({ ...result, items: [] }, { items: [], page: 1, limit: 20, total: 3, totalPages: 1 });
});

test('paginates ordered matches without overlaps and preserves totals beyond the last page', async () => {
  const first = await searchPage({ query: 'molin', page: '1', limit: '2' });
  const second = await searchPage({ query: 'molin', page: '2', limit: '2' });
  const third = await searchPage({ query: 'molin', page: '3', limit: '2' });
  assert.deepEqual(first.items.map(item => item.ticker), ['MOLA', 'MOLI']);
  assert.deepEqual(second.items.map(item => item.ticker), ['SEMI']);
  assert.deepEqual(third.items, []);
  for (const [index, result] of [first, second, third].entries()) {
    assert.deepEqual({ ...result, items: [] }, { items: [], page: index + 1, limit: 2, total: 3, totalPages: 2 });
  }
  const distant = await searchPage({ query: 'molin', page: '9007199254740991', limit: '100' });
  assert.deepEqual(distant.items, []);
  assert.equal(distant.total, 3);
});

test('empty searches have zero total pages', async () => {
  assert.deepEqual(await searchPage({ query: 'no-such-instrument' }), {
    items: [], total: 0, page: 1, limit: 20, totalPages: 0,
  });
});

test('rejects invalid and repeated pagination query parameters', async () => {
  for (const parameters of ['page=0', 'page=-1', 'page=1.5', 'page=abc', 'page=', 'page=1&page=2',
    'limit=0', 'limit=-1', 'limit=1.5', 'limit=101', 'limit=abc', 'limit=', 'limit=1&limit=2']) {
    const response = await fetch(`${baseUrl}/instruments?query=molin&${parameters}`);
    assert.equal(response.status, 400, parameters);
  }
});
