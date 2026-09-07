import type { PortfolioSnapshot } from '../../domain/portfolio';

export class AmbiguousPortfolioAccountError extends Error {}

export interface PortfolioRepository {
  findByUserId(userId: number): Promise<PortfolioSnapshot | null>;
  findByAccountNumber(accountNumber: string): Promise<(PortfolioSnapshot & { userId: number }) | null>;
}
