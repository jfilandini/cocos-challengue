import { instrumentPage } from '../support/http.js';
import type { INestApplication } from '@nestjs/common';
import { InstrumentType } from '../../src/shared/domain/instrument-type.js';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module.js';

// Read-only functional tests against the challenge's seeded PostgreSQL database.
let app: INestApplication;
let baseUrl: string;

before(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
});

after(async () => {
  await app?.close();
});

async function search(term: string) {
  const response = await fetch(`${baseUrl}/instruments?query=${encodeURIComponent(term)}`);
  assert.equal(response.status, 200);
  return instrumentPage.parse(await response.json()).items;
}

async function searchPage(parameters: Record<string, string>) {
  const response = await fetch(`${baseUrl}/instruments?${new URLSearchParams(parameters)}`);
  assert.equal(response.status, 200);
  return instrumentPage.parse(await response.json());
}


void test('finds a partial ticker, ignoring case and surrounding whitespace', async () => {
  const results = await search('  ypF  ');
  assert.deepEqual(results, [
    { id: '50', ticker: 'YPFD', name: 'Y.P.F. S.A.', type: InstrumentType.ACCIONES },
  ]);
});

void test('combines ticker and name matches without duplicate instruments', async () => {
  const results = await search('pamp');
  assert.deepEqual(results.map(({ ticker }) => ticker), ['PAMP']);
});

void test('finds currencies by ticker or name', async () => {
  const cash = { id: '66', ticker: 'ARS', name: 'PESOS', type: InstrumentType.MONEDA };
  assert.deepEqual(await search('pesos'), [cash]);
  assert.deepEqual(await search('ars'), [cash]);
});

void test('treats SQL pattern characters and quotes as literal input', async () => {
  for (const term of ['%', '_', '\\', "' OR 1=1 --"]) {
    assert.deepEqual(await search(term), []);
  }
});

void test('rejects missing, blank, and repeated search terms', async () => {
  for (const query of ['', '?query=', '?query=%20%20', '?query=GGAL&query=BMA']) {
    const response = await fetch(`${baseUrl}/instruments${query}`);
    assert.equal(response.status, 400);
  }
});


void test('finds partial names in ticker order with default pagination metadata', async () => {
  const result = await searchPage({ query: 'mOLin' });
  assert.deepEqual(result.items.map(({ ticker }) => ticker), ['MOLA', 'MOLI', 'SEMI']);
  assert.deepEqual({ ...result, items: [] }, { items: [], page: 1, limit: 20, total: 3, totalPages: 1 });
});

void test('paginates ordered matches without overlaps and preserves totals beyond the last page', async () => {
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

void test('empty searches have zero total pages', async () => {
  assert.deepEqual(await searchPage({ query: 'no-such-instrument' }), {
    items: [], total: 0, page: 1, limit: 20, totalPages: 0,
  });
});

void test('rejects invalid and repeated pagination query parameters', async () => {
  for (const parameters of ['page=0', 'page=-1', 'page=1.5', 'page=abc', 'page=', 'page=1&page=2',
    'limit=0', 'limit=-1', 'limit=1.5', 'limit=101', 'limit=abc', 'limit=', 'limit=1&limit=2']) {
    const response = await fetch(`${baseUrl}/instruments?query=molin&${parameters}`);
    assert.equal(response.status, 400, parameters);
  }
});
