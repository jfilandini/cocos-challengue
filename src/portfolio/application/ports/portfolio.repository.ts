import type { AccountSnapshot } from '../../../account-snapshot/domain/account-snapshot';

export interface PortfolioAccount {
  userId: bigint;
  account: AccountSnapshot;
}

export class AmbiguousPortfolioAccountError extends Error {}

export interface PortfolioRepository {
  findByUserId(userId: bigint): Promise<PortfolioAccount | null>;
  findByAccountNumber(accountNumber: string): Promise<PortfolioAccount | null>;
}
