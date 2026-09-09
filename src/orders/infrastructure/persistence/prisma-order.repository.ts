import { toLedgerMovement } from '../../../shared/infrastructure/database/ledger-movement.mapper';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/infrastructure/database/prisma.service';
import { isInstrumentType } from '../../../shared/domain/instrument-type';
import { isOrderStatus, OrderStatus } from '../../../shared/domain/order-status';
import { PortfolioDataError } from '../../../shared/domain/ledger';
import { OrderCancellationError, OrderResourceNotFoundError } from '../../domain/order';
import type { OrderRepository, OrderTransaction } from '../../application/ports/order.repository';

@Injectable()
export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  withUserLock<T>(userId: bigint, work: (transaction: OrderTransaction) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async tx => {
      const users = await tx.$queryRaw<{ id: bigint }[]>`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      if (!users.length) throw new OrderResourceNotFoundError('User not found');
      return work({
        async findOrder(id) {
          const order = await tx.order.findFirst({ where: { id, userId }, select: { id: true, status: true } });
          if (!order) return null;
          if (!isOrderStatus(order.status)) throw new PortfolioDataError(`Invalid status for order ${id}`);
          return { id: order.id, status: order.status };
        },
        async cancel(id) {
          const result = await tx.order.updateMany({ where: { id, userId, status: OrderStatus.NEW }, data: { status: OrderStatus.CANCELLED } });
          if (result.count !== 1) throw new OrderCancellationError('Only NEW orders can be cancelled');
          return { id, userId, status: OrderStatus.CANCELLED };
        },
        async findInstrument(id) {
          const instrument = await tx.instrument.findUnique({
            where: { id },
            select: { ticker: true, type: true, marketData: { where: { date: { not: null } }, orderBy: [{ date: 'desc' }, { id: 'desc' }], take: 1, select: { close: true } } },
          });
          return instrument ? { ticker: instrument.ticker, type: isInstrumentType(instrument.type) ? instrument.type : null, close: instrument.marketData[0]?.close?.toString() ?? null } : null;
        },
        async readMovements() {
          const orders = await tx.order.findMany({
            where: { userId, status: { in: [OrderStatus.FILLED, OrderStatus.NEW] } },
            orderBy: [{ datetime: 'asc' }, { id: 'asc' }],
            include: { instrument: { select: { ticker: true, type: true } } },
          });
          return orders.map(toLedgerMovement);
        },
        async save(draft) {
          const datetime = new Date();
          const saved = await tx.order.create({ data: { ...draft, datetime } });
          return { ...draft, id: saved.id, datetime: datetime.toISOString() };
        },
      });
    }, { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 10000 });
  }
}
