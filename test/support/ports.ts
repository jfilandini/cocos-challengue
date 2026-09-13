import assert from 'node:assert/strict';
import type { InstrumentRepository } from '../../src/instruments/application/ports/instrument.repository.js';
import type { PortfolioRepository } from '../../src/portfolio/application/ports/portfolio.repository.js';
import type { OrderTransaction } from '../../src/orders/application/ports/order.repository.js';

// Unconfigured operations fail instead of silently returning an empty result.
const unexpected = () => assert.fail('Unexpected call to an unconfigured port operation');

export function instrumentRepository(overrides: Partial<InstrumentRepository>): InstrumentRepository {
  return { search: unexpected, findWithLatestPrices: unexpected, ...overrides };
}

export function portfolioRepository(overrides: Partial<PortfolioRepository>): PortfolioRepository {
  return { findByUserId: unexpected, findByAccountNumber: unexpected, ...overrides };
}

export function orderTransaction(overrides: Partial<OrderTransaction>): OrderTransaction {
  return {
    findInstrumentById: unexpected, findByTransactionId: unexpected, readSnapshot: unexpected, initializeSnapshot: unexpected,
    save: unexpected, findOrder: unexpected, cancel: unexpected, ...overrides,
  };
}
