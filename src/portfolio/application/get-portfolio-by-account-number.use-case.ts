import { calculatePortfolio } from '../domain/portfolio';
import type { PortfolioRepository } from './ports/portfolio.repository';

export class InvalidPortfolioAccountError extends Error {}
export class PortfolioAccountNotFoundError extends Error {}

export class GetPortfolioByAccountNumberUseCase {
  constructor(private readonly portfolios: PortfolioRepository) {}

  async execute(accountNumber: unknown) {
    if (typeof accountNumber !== 'string' || !accountNumber.trim() || accountNumber.trim().length > 20) {
      throw new InvalidPortfolioAccountError('accountNumber must be a string between 1 and 20 characters');
    }
    const snapshot = await this.portfolios.findByAccountNumber(accountNumber.trim());
    if (!snapshot) throw new PortfolioAccountNotFoundError('Account not found');
    return calculatePortfolio(snapshot.userId, snapshot);
  }
}
