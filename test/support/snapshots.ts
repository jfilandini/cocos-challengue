import type { AccountSnapshotRepository, AccountSnapshotRepositoryFactory } from '../../src/snapshot/application/ports/account-snapshot.repository.js';
import { PrismaAccountSnapshotRepository } from '../../src/snapshot/infrastructure/persistence/account-snapshot.repository.js';
import type { PrismaDbClient } from '../../src/snapshot/infrastructure/persistence/account-snapshot.repository.js';

// Decorate the application port while retaining the real caller-owned database transaction.
export function snapshotFactory(
  decorate: (repository: AccountSnapshotRepository, db: PrismaDbClient) => Partial<AccountSnapshotRepository>,
): AccountSnapshotRepositoryFactory<PrismaDbClient> {
  return {
    forTransaction(db) {
      const repository = new PrismaAccountSnapshotRepository(db);
      return {
        read: userId => repository.read(userId),
        initialize: userId => repository.initialize(userId),
        save: (userId, snapshot) => repository.save(userId, snapshot),
        rebuild: userId => repository.rebuild(userId),
        ...decorate(repository, db),
      };
    },
  };
}

export function failingSnapshotFactory() {
  return snapshotFactory(() => ({ save() { throw new Error('Snapshot write failed'); } }));
}
