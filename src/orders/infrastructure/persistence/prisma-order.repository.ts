import { toSnapshotOrder } from '../../../shared/infrastructure/database/snapshot-order.mapper';
import { readAccountSnapshot, saveAccountSnapshot } from '../../../shared/infrastructure/database/account-snapshot.store';
import { applyOrder, cancelPendingOrder } from '../../../shared/domain/account-snapshot';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/infrastructure/database/prisma.service';
import { isInstrumentType } from '../../../shared/domain/instrument-type';
import { isOrderStatus, OrderStatus } from '../../../shared/domain/order-status';
import { PortfolioDataError } from '../../../shared/domain/account-snapshot';
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
          const snapshot = await readAccountSnapshot(tx, userId);
          const order = await tx.order.findFirst({ where: { id, userId, status: OrderStatus.NEW }, include: { instrument: { select: { ticker: true, type: true } } } });
          if (!order) throw new OrderCancellationError('Only NEW orders can be cancelled');
          const next = cancelPendingOrder(snapshot, toSnapshotOrder(order));
          const result = await tx.order.updateMany({ where: { id, userId, status: OrderStatus.NEW }, data: { status: OrderStatus.CANCELLED } });
          if (result.count !== 1) throw new OrderCancellationError('Only NEW orders can be cancelled');
          await saveAccountSnapshot(tx, userId, next);
          return { id, userId, status: OrderStatus.CANCELLED };
        },
        async findInstrument(id) {
          const instrument = await tx.instrument.findUnique({
            where: { id },
            select: { ticker: true, type: true, marketData: { where: { date: { not: null } }, orderBy: [{ date: 'desc' }, { id: 'desc' }], take: 1, select: { close: true } } },
          });
          return instrument ? { ticker: instrument.ticker, type: isInstrumentType(instrument.type) ? instrument.type : null, close: instrument.marketData[0]?.close?.toString() ?? null } : null;
        },
        readSnapshot() {
          return readAccountSnapshot(tx, userId);
        },
        async save(draft) {
          const snapshot = await readAccountSnapshot(tx, userId);
          const datetime = new Date();
          const saved = await tx.order.create({ data: { ...draft, datetime } });
          if (draft.status !== OrderStatus.REJECTED) await saveAccountSnapshot(tx, userId, applyOrder(snapshot, draft));
          return { ...draft, id: saved.id, datetime: datetime.toISOString() };
        },
      });
    }, { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 30000 });
  }
}
