import { ACCOUNT_SNAPSHOT_REPOSITORY_FACTORY, type AccountSnapshotRepositoryFactory } from '../../../snapshot/application/ports/account-snapshot.repository';
import type { Prisma } from '../../../generated/prisma/client';
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
    private readonly snapshots: AccountSnapshotRepositoryFactory<Prisma.TransactionClient>,
  ) {}

  findByUserId(userId: bigint): Promise<PortfolioSnapshot | null> {
    return this.find({ id: userId });
  }

  findByAccountNumber(accountNumber: string) {
    return this.find({ accountNumber });
  }

  private find(where: { id: bigint } | { accountNumber: string }) {
    return this.prisma.$transaction(async tx => {
      const snapshots = this.snapshots.forTransaction(tx);
      const users = await tx.user.findMany({ where, select: { id: true }, take: 2 });
      if (!users.length) return null;
      if (users.length > 1) throw new AmbiguousPortfolioAccountError('Account number matches multiple users');
      const userId = users[0].id;
      const locked = await tx.$queryRaw<{ id: bigint }[]>`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      if (!locked.length) return null;
      const account = await snapshots.read(userId) ?? await snapshots.initialize(userId);
      const instruments = await tx.instrument.findMany({
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
    }, { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 30000 });
  }
}
