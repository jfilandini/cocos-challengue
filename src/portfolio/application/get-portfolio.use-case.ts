import { calculatePortfolio } from '../domain/portfolio';
import type { PortfolioRepository } from './ports/portfolio.repository';

export class InvalidPortfolioUserError extends Error {}
export class PortfolioUserNotFoundError extends Error {}

export class GetPortfolioUseCase {
  constructor(private readonly portfolios: PortfolioRepository) {}

  async execute(userId: number) {
    if (!Number.isInteger(userId) || userId <= 0 || userId > 2147483647) {
      throw new InvalidPortfolioUserError('userId must be a positive 32-bit integer');
    }
    const snapshot = await this.portfolios.findByUserId(userId);
    if (!snapshot) throw new PortfolioUserNotFoundError('User not found');
    return calculatePortfolio(userId, snapshot);
  }
}
