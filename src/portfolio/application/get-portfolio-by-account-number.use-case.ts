import type { InstrumentRepository } from '../../instruments/application/ports/instrument.repository';
import { Currency } from '../../shared/domain/currency';
import { calculatePortfolio } from '../domain/portfolio';
import type { PortfolioRepository } from './ports/portfolio.repository';

export class InvalidPortfolioAccountError extends Error {}
export class PortfolioAccountNotFoundError extends Error {}

export class GetPortfolioByAccountNumberUseCase {
  constructor(
    private readonly portfolios: PortfolioRepository,
    private readonly instruments: InstrumentRepository,
  ) {}

  async execute(accountNumber: unknown) {
    if (typeof accountNumber !== 'string' || !accountNumber.trim() || accountNumber.trim().length > 20) {
      throw new InvalidPortfolioAccountError('accountNumber must be a string between 1 and 20 characters');
    }
    const snapshot = await this.portfolios.findByAccountNumber(accountNumber.trim());
    if (!snapshot) throw new PortfolioAccountNotFoundError('Account not found');
    const instruments = await this.instruments.findWithLatestPrices(
      snapshot.account.positions.map(position => BigInt(position.instrumentId)),
      Currency.ARS,
    );
    return calculatePortfolio(snapshot.userId, { account: snapshot.account, instruments });
  }
}
