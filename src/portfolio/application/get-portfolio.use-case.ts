import type { InstrumentRepository } from '../../instruments/application/ports/instrument.repository';
import { Currency } from '../../shared/domain/currency';
import { validateId } from '../../shared/domain/id-validator-helper';
import { calculatePortfolio } from '../domain/portfolio';
import type { PortfolioRepository } from './ports/portfolio.repository';

export class InvalidPortfolioUserError extends Error {}
export class PortfolioUserNotFoundError extends Error {}

export class GetPortfolioUseCase {
  constructor(
    private readonly portfolios: PortfolioRepository,
    private readonly instruments: InstrumentRepository,
  ) {}

  async execute(userIdInput: unknown) {
    const userId = validateId(userIdInput);
    const snapshot = await this.portfolios.findByUserId(userId);
    if (!snapshot) throw new PortfolioUserNotFoundError('User not found');
    const instruments = await this.instruments.findWithLatestPrices(
      snapshot.account.positions.map(position => BigInt(position.instrumentId)),
      Currency.ARS,
    );
    return calculatePortfolio(userId, { account: snapshot.account, instruments });
  }
}
