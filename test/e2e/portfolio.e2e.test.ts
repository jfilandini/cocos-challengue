import { InstrumentType } from '../../src/shared/domain/instrument-type.js';
import { portfolioResponse } from '../support/http.js';
import type { INestApplication } from '@nestjs/common';
import { present } from '../support/assertions.js';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module.js';

let app: INestApplication;
let baseUrl: string;
before(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
});
after(async () => { await app?.close(); });

void test('seed portfolio includes filled LIMITs, ignores rejected/cancelled orders and uses latest quotes', async () => {
  const response = await fetch(`${baseUrl}/users/1/portfolio`);
  assert.equal(response.status, 200);
  const result = portfolioResponse.parse(await response.json());
  assert.equal(result.totalValue, '889756.00');
  assert.equal(result.cashBalance, '753000.00');
  assert.equal(result.reservedCash, '125500.00');
  assert.equal(result.availableCash, '627500.00');
  assert.deepEqual(result.positions.map(p => [p.ticker, p.quantity, p.marketValue, p.totalReturnPercent]), [
    ['ARS', '753000.00', '753000.00', null],
    ['BMA', -10, '-15028.00', null], ['METR', 500, '114750.00', '-8.20'], ['PAMP', 40, '37034.00', '-0.45'],
  ]);
  assert.ok(result.positions.filter(p => p.type === InstrumentType.ACCIONES).every(p => p.priceDate === '2023-07-14'));
  const cash = result.positions.find(p => p.ticker === 'ARS');
  assert.ok(cash);
  assert.equal(cash.type, 'MONEDA');
  assert.equal(cash.reservedQuantity, result.reservedCash);
  assert.equal(cash.availableQuantity, result.availableCash);
  assert.equal(result.positions.reduce((sum, p) => sum + Number(p.marketValue), 0).toFixed(2), result.totalValue);
  assert.equal(present(result.positions.find(p => p.ticker === 'BMA')).inconsistentHistory, true);
});

void test('existing user without movements has an empty portfolio', async () => {
  const response = await fetch(`${baseUrl}/users/2/portfolio`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { userId: '2', currency: 'ARS', totalValue: '0.00', cashBalance: '0.00', reservedCash: '0.00', availableCash: '0.00', positions: [] });
});

void test('invalid ids return 400 and unknown users return 404', async () => {
  for (const id of ['1.5', 'abc']) {
    assert.equal((await fetch(`${baseUrl}/users/${id}/portfolio`)).status, 400);
  }
  assert.equal((await fetch(`${baseUrl}/users/2147483647/portfolio`)).status, 404);
});

void test('account-number lookup returns the same portfolio as user-id lookup', async () => {
  for (const [accountNumber, userId] of [['10001', 1], ['10002', 2]]) {
    const response = await fetch(`${baseUrl}/accounts/${accountNumber}/portfolio`);
    assert.equal(response.status, 200);
    const byUser = await fetch(`${baseUrl}/users/${userId}/portfolio`);
    assert.deepEqual(await response.json(), await byUser.json());
  }
});

void test('account numbers are exact strings; unknown accounts return 404 and invalid input returns 400', async () => {
  for (const account of ['100', '010001', "' OR 1=1 --"]) {
    assert.equal((await fetch(`${baseUrl}/accounts/${encodeURIComponent(account)}/portfolio`)).status, 404);
  }
  for (const account of [' ', 'a'.repeat(21)]) {
    assert.equal((await fetch(`${baseUrl}/accounts/${encodeURIComponent(account)}/portfolio`)).status, 400);
  }
});
