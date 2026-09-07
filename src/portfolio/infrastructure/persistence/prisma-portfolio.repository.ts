import { Injectable } from '@nestjs/common';
import { isOrderSide, OrderSide } from '../../../shared/domain/order-side';
import { PrismaService } from '../../../shared/infrastructure/database/prisma.service';
import type { PortfolioRepository } from '../../application/ports/portfolio.repository';
import { PortfolioDataError, type PortfolioMovement, type PortfolioSnapshot } from '../../domain/portfolio';

@Injectable()
export class PrismaPortfolioRepository implements PortfolioRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByUserId(userId: number): Promise<PortfolioSnapshot | null> {
    return this.prisma.$transaction(async tx => {
      if (!await tx.user.findUnique({ where: { id: userId }, select: { id: true } })) return null;
      const orders = await tx.order.findMany({
        where: { userId, status: { in: ['FILLED', 'NEW'] } },
        orderBy: [{ datetime: 'asc' }, { id: 'asc' }],
        include: { instrument: { select: { ticker: true, type: true } } },
      });
      const movements: PortfolioMovement[] = orders.map(order => {
        if (order.instrumentId === null || order.size === null || order.price === null || order.datetime === null ||
            !order.type || !isOrderSide(order.side)) {
          throw new PortfolioDataError(`Incomplete movement ${order.id}`);
        }
        const cash = order.side === OrderSide.CASH_IN || order.side === OrderSide.CASH_OUT;
        if (cash ? order.instrument?.ticker !== 'ARS' || order.instrument.type !== 'MONEDA'
          : order.instrument?.type !== 'ACCIONES') {
          throw new PortfolioDataError(`Invalid instrument for movement ${order.id}`);
        }
        return {
          instrumentId: order.instrumentId, size: order.size, price: order.price.toString(),
          side: order.side, status: order.status as PortfolioMovement['status'], type: order.type,
        };
      });
      const instruments = await tx.instrument.findMany({
        where: { id: { in: [...new Set(movements.filter(m => m.side === OrderSide.BUY || m.side === OrderSide.SELL).map(m => m.instrumentId))] } },
        select: {
          id: true, ticker: true, name: true,
          marketData: { where: { date: { not: null } }, orderBy: [{ date: 'desc' }, { id: 'desc' }], take: 1 },
        },
      });
      return {
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
