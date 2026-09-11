import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host.js';
import { errorResponse } from '../support/http.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { InvalidIdError } from '../../src/shared/domain/id-validator-helper.js';
import { InvalidOrderError, OrderResourceNotFoundError, OrderCancellationError, OrderIdempotencyConflictError, OrderPriceUnavailableError } from '../../src/orders/domain/order.js';
import { DomainExceptionFilter } from '../../src/shared/infrastructure/http/domain-exception.filter.js';
import { InvalidInstrumentSearchError } from '../../src/instruments/application/search-instruments.use-case.js';
import {
  InvalidPortfolioUserError,
  PortfolioUserNotFoundError,
} from '../../src/portfolio/application/get-portfolio.use-case.js';
import {
  InvalidPortfolioAccountError,
  PortfolioAccountNotFoundError,
} from '../../src/portfolio/application/get-portfolio-by-account-number.use-case.js';
import { AmbiguousPortfolioAccountError } from '../../src/portfolio/application/ports/portfolio.repository.js';
import {
  PortfolioDataError,
  PortfolioPriceUnavailableError,
} from '../../src/portfolio/domain/portfolio.js';

function createMockHost() {
  let statusCode: number | null = null;
  let responseBody: unknown = null;

  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      responseBody = body;
    },
  };

  const host = new ExecutionContextHost([undefined, response]);

  return {
    host,
    get result() {
      return { statusCode, responseBody };
    },
  };
}

const errorMappings: Array<[number, string, Array<new (message?: string) => Error>]> = [
  [400, 'Bad Request', [InvalidIdError, InvalidOrderError, InvalidInstrumentSearchError, InvalidPortfolioUserError, InvalidPortfolioAccountError]],
  [404, 'Not Found', [OrderResourceNotFoundError, PortfolioUserNotFoundError, PortfolioAccountNotFoundError]],
  [409, 'Conflict', [OrderCancellationError, OrderIdempotencyConflictError, AmbiguousPortfolioAccountError]],
  [422, 'Unprocessable Entity', [PortfolioDataError]],
  [503, 'Service Unavailable', [OrderPriceUnavailableError, PortfolioPriceUnavailableError]],
];

for (const [status, label, errors] of errorMappings) {
  void test(`DomainExceptionFilter maps application and domain errors to ${status}`, () => {
    for (const ErrorType of errors) {
      const mock = createMockHost();
      const message = `Failure: ${ErrorType.name}`;
      new DomainExceptionFilter().catch(new ErrorType(message), mock.host);
      assert.deepEqual(mock.result, {
        statusCode: status,
        responseBody: { statusCode: status, error: label, message },
      }, ErrorType.name);
    }
  });
}

void test('DomainExceptionFilter forwards existing HttpException without modification', () => {
  const filter = new DomainExceptionFilter();
  const mock = createMockHost();
  const customHttp = new BadRequestException('Validation failed');
  filter.catch(customHttp, mock.host);
  assert.equal(mock.result.statusCode, 400);
  assert.equal(errorResponse.parse(mock.result.responseBody).message, 'Validation failed');
});

void test('DomainExceptionFilter hides unknown errors and responds with 500', () => {
  const filter = new DomainExceptionFilter();
  const mock = createMockHost();
  filter.catch(new Error('Unexpected database explosion'), mock.host);
  assert.equal(mock.result.statusCode, 500);
  assert.equal(errorResponse.parse(mock.result.responseBody).statusCode, 500);
  assert.equal(errorResponse.parse(mock.result.responseBody).message, 'Internal server error');
});
