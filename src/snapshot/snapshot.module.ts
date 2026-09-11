import { Module } from '@nestjs/common';
import { ACCOUNT_SNAPSHOT_REPOSITORY_FACTORY } from './application/ports/account-snapshot.repository';
import { PrismaAccountSnapshotRepositoryFactory } from './infrastructure/persistence/account-snapshot.repository';

@Module({
  providers: [{ provide: ACCOUNT_SNAPSHOT_REPOSITORY_FACTORY, useClass: PrismaAccountSnapshotRepositoryFactory }],
  exports: [ACCOUNT_SNAPSHOT_REPOSITORY_FACTORY],
})
export class SnapshotModule {}
