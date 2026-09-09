import type { PortfolioSnapshot } from '../../domain/portfolio';

export class AmbiguousPortfolioAccountError extends Error {}

export interface PortfolioRepository {
  findByUserId(userId: bigint): Promise<PortfolioSnapshot | null>;
  findByAccountNumber(accountNumber: string): Promise<(PortfolioSnapshot & { userId: bigint }) | null>;
}
