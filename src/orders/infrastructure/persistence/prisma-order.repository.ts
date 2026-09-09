import { Prisma } from '../../../generated/prisma/client';
import { z } from 'zod';
import { OrderIdempotencyConflictError } from '../../application/order-idempotency';
import { toSnapshotOrder } from '../../../shared/infrastructure/database/snapshot-order.mapper';
import { initializeAccountSnapshot, readAccountSnapshot, saveAccountSnapshot } from '../../../shared/infrastructure/database/account-snapshot.store';
import { applyOrder, cancelPendingOrder } from '../../../shared/domain/account-snapshot';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/infrastructure/database/prisma.service';
import { isInstrumentType } from '../../../shared/domain/instrument-type';
import { isOrderStatus, OrderStatus } from '../../../shared/domain/order-status';
import { PortfolioDataError } from '../../../shared/domain/account-snapshot';
import { OrderCancellationError, OrderResourceNotFoundError } from '../../domain/order';
import type { OrderRepository, OrderTransaction } from '../../application/ports/order.repository';

const transactionConstraintMetadata = z.object({
  driverAdapterError: z.object({
    cause: z.object({ constraint: z.object({ index: z.literal('uq_orders_transaction') }) }),
  }),
});

@Injectable()
export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  withUserLock<T>(userId: bigint, work: (transaction: OrderTransaction) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async tx => {
      const users = await tx.$queryRaw<{ id: bigint }[]>`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      if (!users.length) throw new OrderResourceNotFoundError('User not found');
      return work({
        async existsByTransactionId(transactionId) {
          const order = await tx.order.findUnique({
            where: { transactionId }, select: { id: true },
          });
          return order !== null;
        },
        async findOrder(id) {
          const order = await tx.order.findFirst({ where: { id, userId }, select: { id: true, status: true } });
          if (!order) return null;
          if (!isOrderStatus(order.status)) throw new PortfolioDataError(`Invalid status for order ${id}`);
          return { id: order.id, status: order.status };
        },
        async cancel(id) {
          const snapshot = await readAccountSnapshot(tx, userId) ?? await initializeAccountSnapshot(tx, userId);
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
        initializeSnapshot() {
          return initializeAccountSnapshot(tx, userId);
        },
        readSnapshot() {
          return readAccountSnapshot(tx, userId);
        },
        async save(draft, transactionId) {
          const snapshot = await readAccountSnapshot(tx, userId) ?? await initializeAccountSnapshot(tx, userId);
          const datetime = new Date();
          const saved = await tx.order.create({ data: { ...draft, transactionId, datetime } });
          if (draft.status !== OrderStatus.REJECTED) await saveAccountSnapshot(tx, userId, applyOrder(snapshot, draft));
          return { ...draft, transactionId, id: saved.id, datetime: datetime.toISOString() };
        },
      });
    }, { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 30000 }).catch((error: unknown) => {
      // Different users hold different locks; the global unique constraint resolves their race.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' &&
          ((Array.isArray(error.meta?.target) && error.meta.target.includes('transactionid')) ||
           transactionConstraintMetadata.safeParse(error.meta).success)) {
        throw new OrderIdempotencyConflictError('transactionId already exists');
      }
      throw error;
    });
  }
}
