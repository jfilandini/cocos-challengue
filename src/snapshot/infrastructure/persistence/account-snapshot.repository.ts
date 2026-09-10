import { Injectable } from '@nestjs/common';
import type { AccountSnapshotRepository, AccountSnapshotRepositoryFactory } from '../../application/ports/account-snapshot.repository';
import type { Prisma } from '../../../generated/prisma/client';
import { applyOrder, emptySnapshot, type AccountSnapshot, type SnapshotPosition } from '../../domain/account-snapshot';
import { OrderStatus } from '../../../shared/domain/order-status';
import { toSnapshotOrder } from './snapshot-order.mapper';

export class PrismaAccountSnapshotRepository implements AccountSnapshotRepository {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  /** Read only: a missing snapshot is returned as null. */
  async read(userId: bigint): Promise<AccountSnapshot | null> {
    const saved = await this.tx.accountSnapshot.findUnique({ where: { userId } });
    if (!saved) return null;
    return {
      settledCash: saved.settledCash.toString(),
      reservedCash: saved.reservedCash.toString(),
      positions: saved.positions as unknown as SnapshotPosition[],
    };
  }

  /** Requires the user lock. Initialize missing state without replacing an existing snapshot. */
  async initialize(userId: bigint): Promise<AccountSnapshot> {
    const existing = await this.read(userId);
    return existing ?? this.rebuild(userId);
  }

  async save(userId: bigint, snapshot: AccountSnapshot): Promise<void> {
    const data = {
      settledCash: snapshot.settledCash,
      reservedCash: snapshot.reservedCash,
      positions: snapshot.positions.map(position => ({ ...position })),
    };
    await this.tx.accountSnapshot.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  }

  async rebuild(userId: bigint): Promise<AccountSnapshot> {
    let snapshot = emptySnapshot();
    let cursor: bigint | undefined;
    for (;;) {
      const orders = await this.tx.order.findMany({
        where: { userId, status: { in: [OrderStatus.FILLED, OrderStatus.NEW] } },
        orderBy: [{ datetime: 'asc' }, { id: 'asc' }],
        take: 1000,
        ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
        include: { instrument: { select: { ticker: true, type: true } } },
      });
      for (const order of orders) snapshot = applyOrder(snapshot, toSnapshotOrder(order));
      if (orders.length < 1000) break;
      cursor = orders[orders.length - 1].id;
    }
    await this.save(userId, snapshot);
    return snapshot;
  }
}

@Injectable()
export class PrismaAccountSnapshotRepositoryFactory implements AccountSnapshotRepositoryFactory<Prisma.TransactionClient> {
  forTransaction(transaction: Prisma.TransactionClient): AccountSnapshotRepository {
    return new PrismaAccountSnapshotRepository(transaction);
  }
}
