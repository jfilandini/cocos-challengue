import type { AccountSnapshot } from '../../domain/account-snapshot';

export interface AccountSnapshotRepository {
  read(userId: bigint): Promise<AccountSnapshot | null>;
  initialize(userId: bigint): Promise<AccountSnapshot>;
  save(userId: bigint, snapshot: AccountSnapshot): Promise<void>;
  rebuild(userId: bigint): Promise<AccountSnapshot>;
}
