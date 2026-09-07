import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { DomainExceptionFilter } from '../dist/shared/infrastructure/http/domain-exception.filter.js';
import { InvalidInstrumentSearchError } from '../dist/instruments/application/search-instruments.use-case.js';
import {
  InvalidPortfolioUserError,
  PortfolioUserNotFoundError,
} from '../dist/portfolio/application/get-portfolio.use-case.js';
import {
  InvalidPortfolioAccountError,
  PortfolioAccountNotFoundError,
} from '../dist/portfolio/application/get-portfolio-by-account-number.use-case.js';
import { AmbiguousPortfolioAccountError } from '../dist/portfolio/application/ports/portfolio.repository.js';
import {
  PortfolioDataError,
  PortfolioPriceUnavailableError,
} from '../dist/portfolio/domain/portfolio.js';

function createMockHost() {
  let statusCode = null;
  let responseBody = null;

  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      responseBody = body;
    },
  };

  const host = {
    switchToHttp() {
      return {
        getResponse() {
          return response;
        },
      };
    },
  };

  return {
    host,
    get result() {
      return { statusCode, responseBody };
    },
  };
}

test('DomainExceptionFilter translates bad request domain errors to 400', () => {
  const filter = new DomainExceptionFilter();

  for (const error of [
    new InvalidInstrumentSearchError(),
    new InvalidPortfolioUserError('Invalid user'),
    new InvalidPortfolioAccountError('Invalid account'),
  ]) {
    const mock = createMockHost();
    filter.catch(error, mock.host);
    assert.equal(mock.result.statusCode, 400);
    assert.equal(mock.result.responseBody.statusCode, 400);
    assert.equal(mock.result.responseBody.error, 'Bad Request');
  }
});

test('DomainExceptionFilter translates not found errors to 404', () => {
  const filter = new DomainExceptionFilter();

  for (const error of [
    new PortfolioUserNotFoundError('User not found'),
    new PortfolioAccountNotFoundError('Account not found'),
  ]) {
    const mock = createMockHost();
    filter.catch(error, mock.host);
    assert.equal(mock.result.statusCode, 404);
    assert.equal(mock.result.responseBody.statusCode, 404);
    assert.equal(mock.result.responseBody.error, 'Not Found');
  }
});

test('DomainExceptionFilter translates conflict errors to 409', () => {
  const filter = new DomainExceptionFilter();
  const mock = createMockHost();
  filter.catch(new AmbiguousPortfolioAccountError('Ambiguous account'), mock.host);
  assert.equal(mock.result.statusCode, 409);
  assert.equal(mock.result.responseBody.statusCode, 409);
  assert.equal(mock.result.responseBody.error, 'Conflict');
});

test('DomainExceptionFilter translates data error to 422', () => {
  const filter = new DomainExceptionFilter();
  const mock = createMockHost();
  filter.catch(new PortfolioDataError('Incomplete movement'), mock.host);
  assert.equal(mock.result.statusCode, 422);
  assert.equal(mock.result.responseBody.statusCode, 422);
  assert.equal(mock.result.responseBody.error, 'Unprocessable Entity');
});

test('DomainExceptionFilter translates price unavailable error to 503', () => {
  const filter = new DomainExceptionFilter();
  const mock = createMockHost();
  filter.catch(new PortfolioPriceUnavailableError('Price unavailable'), mock.host);
  assert.equal(mock.result.statusCode, 503);
  assert.equal(mock.result.responseBody.statusCode, 503);
  assert.equal(mock.result.responseBody.error, 'Service Unavailable');
});

test('DomainExceptionFilter forwards existing HttpException without modification', () => {
  const filter = new DomainExceptionFilter();
  const mock = createMockHost();
  const customHttp = new BadRequestException('Validation failed');
  filter.catch(customHttp, mock.host);
  assert.equal(mock.result.statusCode, 400);
  assert.equal(mock.result.responseBody.message, 'Validation failed');
});

test('DomainExceptionFilter hides unknown errors and responds with 500', () => {
  const filter = new DomainExceptionFilter();
  const mock = createMockHost();
  filter.catch(new Error('Unexpected database explosion'), mock.host);
  assert.equal(mock.result.statusCode, 500);
  assert.equal(mock.result.responseBody.statusCode, 500);
  assert.equal(mock.result.responseBody.message, 'Internal server error');
});
