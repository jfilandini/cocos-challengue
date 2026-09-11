import { ACCOUNT_SNAPSHOT_REPOSITORY_FACTORY, type AccountSnapshotRepositoryFactory } from '../../../snapshot/application/ports/account-snapshot.repository';
import type { PrismaDbClient } from '../../../snapshot/infrastructure/persistence/account-snapshot.repository';
import { Inject, Injectable } from '@nestjs/common';
import { InstrumentType } from '../../../shared/domain/instrument-type';
import { Currency } from '../../../shared/domain/currency';
import { PrismaService } from '../../../shared/infrastructure/database/prisma.service';
import { AmbiguousPortfolioAccountError, type PortfolioRepository } from '../../application/ports/portfolio.repository';
import { type PortfolioSnapshot } from '../../domain/portfolio';

@Injectable()
export class PrismaPortfolioRepository implements PortfolioRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ACCOUNT_SNAPSHOT_REPOSITORY_FACTORY)
    private readonly snapshots: AccountSnapshotRepositoryFactory<PrismaDbClient>,
  ) {}

  findByUserId(userId: bigint): Promise<PortfolioSnapshot | null> {
    return this.find({ id: userId });
  }

  findByAccountNumber(accountNumber: string) {
    return this.find({ accountNumber });
  }

  private async find(where: { id: bigint } | { accountNumber: string }): Promise<(PortfolioSnapshot & { userId: bigint }) | null> {
    const users = await this.prisma.user.findMany({ where, select: { id: true }, take: 2 });
    if (!users.length) return null;
    if (users.length > 1) throw new AmbiguousPortfolioAccountError('Account number matches multiple users');
    const userId = users[0].id;

    // Fast path: non-blocking read via PostgreSQL MVCC (no locks)
    let account = await this.snapshots.forTransaction(this.prisma).read(userId);

    // Slow path: acquire exclusive user lock only if snapshot has not been generated yet
    if (!account) {
      account = await this.prisma.$transaction(async tx => {
        const locked = await tx.$queryRaw<{ id: bigint }[]>`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
        if (!locked.length) return null;
        return this.snapshots.forTransaction(tx).initialize(userId);
      }, { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 30000 });
      if (!account) return null;
    }

    const instruments = await this.prisma.instrument.findMany({
      where: { OR: [
        { id: { in: account.positions.map(position => BigInt(position.instrumentId)) } },
        { ticker: Currency.ARS, type: InstrumentType.MONEDA },
      ] },
      select: {
        id: true, ticker: true, name: true,
        marketData: { orderBy: [{ date: 'desc' }, { id: 'desc' }], take: 1 },
      },
    });

    return {
      userId,
      account,
      instruments: instruments.map(({ id, ticker, name, marketData }) => ({
        id, ticker, name,
        close: marketData[0]?.close.toString() ?? null,
        previousClose: marketData[0]?.previousClose?.toString() ?? null,
        date: marketData[0]?.date.toISOString().slice(0, 10) ?? null,
      })),
    };
  }
}
