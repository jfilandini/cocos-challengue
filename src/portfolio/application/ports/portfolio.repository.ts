import type { PortfolioSnapshot } from '../../domain/portfolio';

export interface PortfolioRepository {
  /** A consistent snapshot; null means the user does not exist. */
  findByUserId(userId: number): Promise<PortfolioSnapshot | null>;
}
