import { PrismaAccountSnapshotRepository } from '../../../account-snapshot/infrastructure/persistence/account-snapshot.repository';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/infrastructure/database/prisma.service';
import { AmbiguousPortfolioAccountError, type PortfolioAccount, type PortfolioRepository } from '../../application/ports/portfolio.repository';

@Injectable()
export class PrismaPortfolioRepository implements PortfolioRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: PrismaAccountSnapshotRepository,
  ) {}

  findByUserId(userId: bigint): Promise<PortfolioAccount | null> {
    return this.find({ id: userId });
  }

  findByAccountNumber(accountNumber: string) {
    return this.find({ accountNumber });
  }

  private async find(where: { id: bigint } | { accountNumber: string }): Promise<PortfolioAccount | null> {
    const users = await this.prisma.user.findMany({ where, select: { id: true }, take: 2 });
    if (!users.length) return null;
    if (users.length > 1) throw new AmbiguousPortfolioAccountError('Account number matches multiple users');
    const userId = users[0].id;

    let account = await this.snapshots.read(userId);

    // Slow path: acquire exclusive user lock only if snapshot has not been generated yet
    if (!account) {
      account = await this.prisma.$transaction(async tx => {
        const locked = await tx.$queryRaw<{ id: bigint }[]>`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
        if (!locked.length) return null;
        return new PrismaAccountSnapshotRepository(tx).initialize(userId);
      }, { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 30000 });
      if (!account) return null;
    }

    return { userId, account };
  }
}
