import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';

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
  return response.json();
}

test('finds a partial ticker, ignoring case and surrounding whitespace', async () => {
  const results = await search('  ypF  ');
  assert.deepEqual(results, [
    { id: 50, ticker: 'YPFD', name: 'Y.P.F. S.A.', type: 'ACCIONES' },
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
  const cash = { id: 66, ticker: 'ARS', name: 'PESOS', type: 'MONEDA' };
  assert.deepEqual(await search('pesos'), [cash]);
  assert.deepEqual(await search('ars'), [cash]);
});

test('treats SQL pattern characters and quotes as literal input', async () => {
  for (const term of ['%', '_', '\\', "' OR 1=1 --"]) {
    assert.deepEqual(await search(term), []);
  }
});

test('rejects missing, blank, repeated, and oversized search terms', async () => {
  for (const query of ['', '?query=', '?query=%20%20', '?query=GGAL&query=BMA', `?query=${'a'.repeat(256)}`]) {
    const response = await fetch(`${baseUrl}/instruments${query}`);
    assert.equal(response.status, 400);
  }
});
