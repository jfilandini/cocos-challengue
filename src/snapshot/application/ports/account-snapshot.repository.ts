import type { AccountSnapshot } from '../../domain/account-snapshot';

/** Bound to the caller's transaction. Writes require the user lock. */
export interface AccountSnapshotRepository {
  /** Returns null when missing; never creates state. */
  read(userId: bigint): Promise<AccountSnapshot | null>;
  /** Creates missing state from orders; preserves an existing snapshot. */
  initialize(userId: bigint): Promise<AccountSnapshot>;
  save(userId: bigint, snapshot: AccountSnapshot): Promise<void>;
  /** Replaces derived state by replaying the orders ledger. */
  rebuild(userId: bigint): Promise<AccountSnapshot>;
}

export interface AccountSnapshotRepositoryFactory<Transaction> {
  forTransaction(transaction: Transaction): AccountSnapshotRepository;
}

export const ACCOUNT_SNAPSHOT_REPOSITORY_FACTORY = Symbol('AccountSnapshotRepositoryFactory');
