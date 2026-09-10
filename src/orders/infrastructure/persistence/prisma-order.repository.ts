import { Prisma } from '../../../generated/prisma/client';
import { z } from 'zod';
import { toSnapshotOrder } from '../../../snapshot/infrastructure/persistence/snapshot-order.mapper';
import { initializeAccountSnapshot, readAccountSnapshot, saveAccountSnapshot } from '../../../snapshot/infrastructure/persistence/account-snapshot.repository';
import { applyOrder, cancelPendingOrder, PortfolioDataError } from '../../../snapshot/domain/account-snapshot';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/infrastructure/database/prisma.service';
import { isOrderStatus, OrderStatus } from '../../../shared/domain/order-status';
import { OrderCancellationError, OrderIdempotencyConflictError, OrderResourceNotFoundError } from '../../domain/order';
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
