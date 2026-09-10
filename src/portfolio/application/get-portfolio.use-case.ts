import { validateId } from '../../shared/domain/id-validator-helper';
import { calculatePortfolio } from '../domain/portfolio';
import type { PortfolioRepository } from './ports/portfolio.repository';

export class InvalidPortfolioUserError extends Error {}
export class PortfolioUserNotFoundError extends Error {}

export class GetPortfolioUseCase {
  constructor(private readonly portfolios: PortfolioRepository) {}

  async execute(userIdInput: unknown) {
    const userId = validateId(userIdInput);
    const snapshot = await this.portfolios.findByUserId(userId);
    if (!snapshot) throw new PortfolioUserNotFoundError('User not found');
    return calculatePortfolio(userId, snapshot);
  }
}
