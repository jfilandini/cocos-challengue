import { validateIdInput } from '../../shared/domain/database-validator-helper';
import { calculatePortfolio } from '../domain/portfolio';
import type { PortfolioRepository } from './ports/portfolio.repository';

export class InvalidPortfolioUserError extends Error {}
export class PortfolioUserNotFoundError extends Error {}

export class GetPortfolioUseCase {
  constructor(private readonly portfolios: PortfolioRepository) {}

  async execute(userIdInput: unknown) {
    const userId = validateIdInput(userIdInput);
    const snapshot = await this.portfolios.findByUserId(userId);
    if (!snapshot) throw new PortfolioUserNotFoundError('User not found');
    return calculatePortfolio(userId, snapshot);
  }
}
