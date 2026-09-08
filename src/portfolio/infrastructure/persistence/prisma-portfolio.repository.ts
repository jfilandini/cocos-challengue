import { toLedgerMovement } from '../../../shared/infrastructure/database/ledger-movement.mapper';
import { Injectable } from '@nestjs/common';
import { OrderSide } from '../../../shared/domain/order-side';
import { OrderStatus } from '../../../shared/domain/order-status';
import { InstrumentType } from '../../../shared/domain/instrument-type';
import { Currency } from '../../../shared/domain/currency';
import { PrismaService } from '../../../shared/infrastructure/database/prisma.service';
import { AmbiguousPortfolioAccountError, type PortfolioRepository } from '../../application/ports/portfolio.repository';
import { type PortfolioSnapshot } from '../../domain/portfolio';

@Injectable()
export class PrismaPortfolioRepository implements PortfolioRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByUserId(userId: number): Promise<PortfolioSnapshot | null> {
    return this.find({ id: userId });
  }

  findByAccountNumber(accountNumber: string) {
    return this.find({ accountNumber });
  }

  private find(where: { id: number } | { accountNumber: string }) {
    return this.prisma.$transaction(async tx => {
      const users = await tx.user.findMany({ where, select: { id: true }, take: 2 });
      if (!users.length) return null;
      if (users.length > 1) throw new AmbiguousPortfolioAccountError('Account number matches multiple users');
      const userId = users[0].id;
      const orders = await tx.order.findMany({
        where: { userId, status: { in: [OrderStatus.FILLED, OrderStatus.NEW] } },
        orderBy: [{ datetime: 'asc' }, { id: 'asc' }],
        include: { instrument: { select: { ticker: true, type: true } } },
      });
      const movements = orders.map(toLedgerMovement);
      const instruments = await tx.instrument.findMany({
        where: { OR: [
          { id: { in: [...new Set(movements.filter(m => m.side === OrderSide.BUY || m.side === OrderSide.SELL).map(m => m.instrumentId))] } },
          { ticker: Currency.ARS, type: InstrumentType.MONEDA },
        ] },
        select: {
          id: true, ticker: true, name: true,
          marketData: { where: { date: { not: null } }, orderBy: [{ date: 'desc' }, { id: 'desc' }], take: 1 },
        },
      });
      return {
        userId,
        movements,
        instruments: instruments.map(({ id, ticker, name, marketData }) => ({
          id, ticker, name,
          close: marketData[0]?.close?.toString() ?? null,
          previousClose: marketData[0]?.previousClose?.toString() ?? null,
          date: marketData[0]?.date?.toISOString().slice(0, 10) ?? null,
        })),
      };
    }, { isolationLevel: 'RepeatableRead' });
  }
}
