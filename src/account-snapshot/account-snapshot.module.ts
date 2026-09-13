import { Module } from '@nestjs/common';
import { DatabaseModule } from '../shared/infrastructure/database/database.module';
import { PrismaService } from '../shared/infrastructure/database/prisma.service';
import { PrismaAccountSnapshotRepository } from './infrastructure/persistence/account-snapshot.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: PrismaAccountSnapshotRepository,
      useFactory: (prisma: PrismaService) => new PrismaAccountSnapshotRepository(prisma),
      inject: [PrismaService],
    },
  ],
  exports: [PrismaAccountSnapshotRepository],
})
export class AccountSnapshotModule {}
