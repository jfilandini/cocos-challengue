import { isOrderSide } from '../../../shared/domain/order-side';
import { isOrderType } from '../../../shared/domain/order-type';
import { ACCOUNT_SNAPSHOT_REPOSITORY_FACTORY, type AccountSnapshotRepositoryFactory } from '../../../snapshot/application/ports/account-snapshot.repository';
import { Prisma } from '../../../generated/prisma/client';
import { z } from 'zod';
import { toSnapshotOrder } from '../../../snapshot/infrastructure/persistence/snapshot-order.mapper';
import { applyOrder, releaseOrderReservation, PortfolioDataError } from '../../../snapshot/domain/account-snapshot';
import { Inject, Injectable } from '@nestjs/common';
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
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ACCOUNT_SNAPSHOT_REPOSITORY_FACTORY)
    private readonly snapshots: AccountSnapshotRepositoryFactory<Prisma.TransactionClient>,
  ) {}

  withUserLock<T>(userId: bigint, work: (transaction: OrderTransaction) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async tx => {
      const snapshots = this.snapshots.forTransaction(tx);
      const users = await tx.$queryRaw<{ id: bigint }[]>`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      if (!users.length) throw new OrderResourceNotFoundError('User not found');
      return work({
        async findByTransactionId(transactionId) {
          const order = await tx.order.findUnique({
            where: { transactionId },
          });
          if (!order) return null;
          if (!isOrderSide(order.side) || !isOrderType(order.type) || !isOrderStatus(order.status)) {
            throw new PortfolioDataError(`Invalid persisted order ${order.id}`);
          }
          return {
            originalRequest: order.originalRequest,
            order: {
              id: order.id, userId: order.userId, instrumentId: order.instrumentId,
              transactionId, side: order.side, type: order.type, status: order.status,
              size: order.size, price: order.price.toFixed(2), datetime: order.datetime.toISOString(),
            },
          };
        },
        async findOrder(id) {
          const order = await tx.order.findFirst({ where: { id, userId }, select: { id: true, status: true } });
          if (!order) return null;
          if (!isOrderStatus(order.status)) throw new PortfolioDataError(`Invalid status for order ${id}`);
          return { id: order.id, status: order.status };
        },
        async cancel(id) {
          const snapshot = await snapshots.read(userId) ?? await snapshots.initialize(userId);
          const order = await tx.order.findFirst({ where: { id, userId, status: OrderStatus.NEW }, include: { instrument: { select: { ticker: true, type: true } } } });
          if (!order) throw new OrderCancellationError('Only NEW orders can be cancelled');
          const next = releaseOrderReservation(snapshot, toSnapshotOrder(order));
          const result = await tx.order.updateMany({ where: { id, userId, status: OrderStatus.NEW }, data: { status: OrderStatus.CANCELLED } });
          if (result.count !== 1) throw new OrderCancellationError('Only NEW orders can be cancelled');
          await snapshots.save(userId, next);
          return { id, userId, status: OrderStatus.CANCELLED };
        },
        initializeSnapshot() {
          return snapshots.initialize(userId);
        },
        readSnapshot() {
          return snapshots.read(userId);
        },
        async save(draft, transactionId, originalRequest) {
          const snapshot = await snapshots.read(userId) ?? await snapshots.initialize(userId);
          const datetime = new Date();
          const saved = await tx.order.create({ data: { ...draft, transactionId, originalRequest, datetime } });
          if (draft.status !== OrderStatus.REJECTED) await snapshots.save(userId, applyOrder(snapshot, draft));
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
